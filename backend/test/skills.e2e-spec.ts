// The skill check end to end: level, the timed exam (marked on the server), leaving the app, retakes, the work video
// and certificates, HQ's decisions, and what they unlock (approval, job offers per verified trade, certifications).
// The test clock starts at 2026-10-16 12:00 IST.
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { seedCatalog } from '../src/modules/catalog/catalog.seed';
import { SECTIONS } from '../src/modules/skills/exam-rules';
import { SkillsReviewService } from '../src/modules/skills/skills-review.service';
import { SkillsService } from '../src/modules/skills/skills.service';
import { TechVerificationService } from '../src/modules/technicians/tech-verification.service';
import { buildTestApp, createTechnician, requireTestDatabase, resetDatabase, signIn, type TestApp } from './helpers';
import { hasBytes, mp4Video, pdf } from './media-fixtures';

const SEC = 1000;
const HQ = { id: randomUUID(), ip: '10.0.0.1' };

interface Exam {
  id: string;
  state: string;
  currentSection: number;
  questions: { id: string; section: number; type: string; options: { id: string }[] }[];
  answers: Record<string, string>;
  leftApp: number;
  /** On a refused request. */
  error?: { message: string };
  result: null | { correct: number; points: number; basePoints: number; bonusPoints: number; passed: boolean; autoSubmitted: boolean; retakeAt: number | null; questions: { changes: number; fast: boolean }[] };
}

describe('skill check (e2e)', () => {
  let t: TestApp;
  const api = () => request(t.app.getHttpServer());
  const as = (token: string) => ({ Authorization: `Bearer ${token}` });
  const bank = () => t.app.get(SkillsService).bank;
  const review = () => t.app.get(SkillsReviewService);
  let tech: { id: string; token: string };

  beforeAll(async () => {
    requireTestDatabase();
    t = await buildTestApp({ env: { SKILL_CHECK_REQUIRED: 'true', AUTO_APPROVE_TECHNICIANS: 'true' } });
  });

  beforeEach(async () => {
    await resetDatabase(t.prisma);
    await seedCatalog(t.prisma);
    t.rateLimits.clear();
    t.store.objects.clear();
    t.clock.t = Date.UTC(2026, 9, 16, 6, 30);
    // A new technician (plumbing and cleaning) whose Aadhaar and photo checks passed: only the skill check is missing.
    tech = await createTechnician(t, '9876500011', { approve: false });
    await t.prisma.technician.update({ where: { userId: tech.id }, data: { aadhaarVerifiedAt: new Date(t.clock.now()), aadhaarLast4: '1234', aadhaarNameMatch: true, aadhaarGenderMatch: true } });
  });

  afterAll(async () => {
    await t?.close();
  });

  /** Signs in again after the clock moved past the access token's life. */
  async function later(ms: number) {
    t.clock.advance(ms);
    tech = { id: tech.id, token: (await signIn(t, '9876500011', 'TECHNICIAN')).accessToken };
  }

  const skills = async () => (await api().get('/v1/tech/skills').set(as(tech.token)).expect(200)).body;
  const me = async () => (await api().get('/v1/tech/me').set(as(tech.token)).expect(200)).body;
  const start = async (categoryId = 'PLUMBING', status = 200) => (await api().post('/v1/tech/skills/exams').set(as(tech.token)).send({ categoryId }).expect(status)).body;
  const open = async (exam: Exam, index: number, status = 200) => (await api().post(`/v1/tech/skills/exams/${exam.id}/sections/${index}/start`).set(as(tech.token)).expect(status)).body as Exam;
  const answer = async (exam: Exam, questionId: string, optionId: string, status = 200) =>
    (await api().put(`/v1/tech/skills/exams/${exam.id}/answers/${questionId}`).set(as(tech.token)).send({ optionId }).expect(status)).body as Exam;
  const right = (exam: Exam, questionId: string) => bank().answerKey(exam.id, questionId);
  const wrong = (exam: Exam, questionId: string) => exam.questions.find((q) => q.id === questionId)!.options.find((o) => o.id !== right(exam, questionId))!.id;

  async function upload(kind: 'videos' | 'documents', bytes: Buffer, contentType: string): Promise<string> {
    const res = await api().post(`/v1/uploads/${kind}`).set(as(tech.token)).send({ contentType, bytes: bytes.length }).expect(200);
    t.store.upload(res.body.id, bytes, contentType);
    return res.body.id as string;
  }

  /** Answers a whole paper: `rightCount` right answers (the rest wrong), each a few seconds after the one before. */
  async function takeExam(exam: Exam, rightCount: number): Promise<Exam> {
    let n = 0;
    for (let s = 0; s < SECTIONS.length; s++) {
      exam = await open(exam, s);
      for (const q of exam.questions.filter((x) => x.section === s)) {
        t.clock.advance(5 * SEC);
        exam = await answer(exam, q.id, n++ < rightCount ? right(exam, q.id) : wrong(exam, q.id));
      }
    }
    return (await api().post(`/v1/tech/skills/exams/${exam.id}/submit`).set(as(tech.token)).expect(200)).body;
  }

  describe('the exam', () => {
    it('is required for a new technician, marked on the server, and a pass verifies the trade; sending it starts the review', async () => {
      expect((await me()).skillCheck).toEqual({ level: null, required: true, submittedAt: null, verifiedSkills: [], certifications: [] });
      expect(await skills()).toMatchObject({ level: null, required: true, canSubmit: false, demo: false, video: null, certificates: [] });
      expect((await start('PLUMBING', 409)).error.message).toMatch(/level/);
      await api().put('/v1/tech/skills/level').set(as(tech.token)).send({ level: 'SKILLED' }).expect(200);
      expect((await start('AC', 422)).error.fields).toEqual({ categoryId: 'INVALID' }); // not one of their trades

      let exam: Exam = await start();
      // Three sections (3 MCQs, 3 diagram questions, 4 part questions) of the SKILLED band; never the answers.
      expect(exam.questions.map((q) => [q.section, q.type])).toEqual([[0, 'MCQ'], [0, 'MCQ'], [0, 'MCQ'], [1, 'DIAGRAM'], [1, 'DIAGRAM'], [1, 'DIAGRAM'], [2, 'SELECT'], [2, 'SELECT'], [2, 'SELECT'], [2, 'SELECT']]);
      expect(exam.questions.every((q) => bank().question(q.id).band === 3 && bank().question(q.id).trade === 'PLUMBING')).toBe(true);
      expect(JSON.stringify(exam)).not.toMatch(/"answer"/);
      expect((await start()).id).toBe(exam.id); // the same paper while it runs
      expect((await start('CLEANING', 409)).error.message).toMatch(/finish/);

      // Nothing can be answered before its section opens; sections open in order.
      const [q1, q2] = exam.questions;
      await answer(exam, q1!.id, right(exam, q1!.id), 409);
      await open(exam, 1, 409);
      exam = await open(exam, 0);
      // A changed answer counts as a change (twice here).
      t.clock.advance(3 * SEC);
      await answer(exam, q1!.id, wrong(exam, q1!.id));
      await answer(exam, q1!.id, right(exam, q1!.id));
      exam = await answer(exam, q1!.id, wrong(exam, q1!.id));
      exam = await answer(exam, q1!.id, right(exam, q1!.id));
      expect(exam.answers[q1!.id]).toBe(right(exam, q1!.id));
      exam = await open(exam, 1);
      // The first section is closed now.
      await answer(exam, q2!.id, right(exam, q2!.id), 409);

      const done = (await api().post(`/v1/tech/skills/exams/${exam.id}/submit`).set(as(tech.token)).expect(200)).body as Exam;
      expect(done.state).toBe('SUBMITTED');
      expect(done.result).toMatchObject({ correct: 1, basePoints: 2, passed: false, autoSubmitted: false });
      expect(done.result!.questions[0]!.changes).toBe(3);

      // Failed: again after a day.
      const wait = await start('PLUMBING', 409);
      expect(wait.error.retryAfterSec).toBe(24 * 3600);
      await later(24 * 3600 * SEC);
      const passed = await takeExam(await start(), 10);
      // 10 right: 20 points, plus 1 for each of the 4 part questions answered fast.
      expect(passed.result).toMatchObject({ correct: 10, basePoints: 20, bonusPoints: 4, points: 24, passed: true, retakeAt: null });
      expect((await skills()).trades).toEqual([
        expect.objectContaining({ categoryId: 'PLUMBING', verifiedVia: 'EXAM', exam: expect.objectContaining({ state: 'PASSED', points: 24 }) }),
        expect.objectContaining({ categoryId: 'CLEANING', verifiedVia: null, exam: expect.objectContaining({ state: 'NONE' }) }),
      ]);
      await start('PLUMBING', 409); // already verified

      // Not approved yet: the skill check has not been sent. The level is fixed now.
      expect((await me()).verification).toBe('PENDING');
      await api().put('/v1/tech/skills/level').set(as(tech.token)).send({ level: 'UNSKILLED' }).expect(409);
      const sent = (await api().post('/v1/tech/skills/submit').set(as(tech.token)).expect(200)).body;
      expect(sent.submittedAt).toBe(t.clock.now());
      // Approved automatically, shown from the review time counted from now (12:00 IST + 2 h... a day later).
      const profile = await me();
      expect(profile.verification).toBe('APPROVED');
      expect(profile.reviewBy).toBe(t.clock.now() + 2 * 3600 * SEC);
      expect(profile.skillCheck).toMatchObject({ required: false, verifiedSkills: ['PLUMBING'] });
    });

    it('closes a section when its time is up and the whole paper at its end', async () => {
      await api().put('/v1/tech/skills/level').set(as(tech.token)).send({ level: 'UNSKILLED' }).expect(200);
      let exam: Exam = await start();
      expect(exam.questions.every((q) => bank().question(q.id).band === 1)).toBe(true);
      exam = await open(exam, 0);
      const q = exam.questions[0]!;
      t.clock.advance(180 * SEC + 4 * SEC); // within the network grace
      await answer(exam, q.id, right(exam, q.id));
      t.clock.advance(2 * SEC);
      expect((await answer(exam, q.id, wrong(exam, q.id), 409)).error?.message).toMatch(/time is up/);
      // Left alone: the paper is marked when its 12 minutes (plus grace) are over.
      t.clock.advance(12 * 60 * SEC);
      exam = (await api().get(`/v1/tech/skills/exams/${exam.id}`).set(as(tech.token)).expect(200)).body;
      expect(exam).toMatchObject({ state: 'SUBMITTED', result: { correct: 1, autoSubmitted: true, passed: false } });
    });

    it('submits the exam the third time the app is left', async () => {
      await api().put('/v1/tech/skills/level').set(as(tech.token)).send({ level: 'HIGHLY_SKILLED' }).expect(200);
      const exam: Exam = await start('CLEANING');
      for (const n of [1, 2]) {
        const after = (await api().post(`/v1/tech/skills/exams/${exam.id}/left-app`).set(as(tech.token)).expect(200)).body;
        expect([after.leftApp, after.state]).toEqual([n, 'IN_PROGRESS']);
      }
      const third = (await api().post(`/v1/tech/skills/exams/${exam.id}/left-app`).set(as(tech.token)).expect(200)).body;
      expect(third).toMatchObject({ leftApp: 3, state: 'SUBMITTED', result: { autoSubmitted: true, passed: false } });
      // HQ sees every question: what was chosen, what was right, how long it took.
      const detail = await review().detail(tech.id);
      expect(detail.attempts[0]).toMatchObject({ categoryId: 'CLEANING', leftApp: 3, autoSubmitted: true, passed: false });
      expect(detail.attempts[0]!.questions[0]).toMatchObject({ chosen: null, correct: false });
      expect(detail.attempts[0]!.questions[0]!.right.length).toBeGreaterThan(0);
    });
  });

  describe('work video and certificates', () => {
    it('needs a real 1-2 minute video; HQ approves it for the trades it shows, which approves the profile', async () => {
      await api().put('/v1/tech/skills/level').set(as(tech.token)).send({ level: 'SEMI_SKILLED' }).expect(200);
      await api().post('/v1/tech/skills/submit').set(as(tech.token)).expect(409); // nothing to send yet

      const short = await upload('videos', mp4Video(30), 'video/mp4');
      expect((await api().post('/v1/tech/skills/video').set(as(tech.token)).send({ source: 'UPLOAD', uploadId: short }).expect(422)).body.error.message).toMatch(/1 minute/);
      const long = await upload('videos', mp4Video(150), 'video/mp4');
      expect((await api().post('/v1/tech/skills/video').set(as(tech.token)).send({ source: 'LIVE', uploadId: long }).expect(422)).body.error.message).toMatch(/longer than/);
      await api().post('/v1/tech/skills/video').set(as(tech.token)).send({ source: 'SAMPLE' }).expect(422); // demo accounts only

      const good = await upload('videos', mp4Video(95), 'video/mp4');
      const check = (await api().post('/v1/tech/skills/video').set(as(tech.token)).send({ source: 'LIVE', uploadId: good }).expect(200)).body;
      expect(check.video).toMatchObject({ source: 'LIVE', status: 'PENDING', durationSec: 95 });
      // Where it was recorded is gone from the stored copy.
      expect(hasBytes(t.store.objects.get(`v/${good}`)!.bytes, '+17.4126')).toBe(false);

      // Sent: the review starts, but a video waits for a person.
      expect((await api().post('/v1/tech/skills/submit').set(as(tech.token)).expect(200)).body.submittedAt).toBe(t.clock.now());
      expect((await me()).verification).toBe('PENDING');
      // HQ cannot approve the profile while no trade is verified.
      await expect(t.app.get(TechVerificationService).approve(tech.id, { type: 'ADMIN', id: null, via: 'test' })).rejects.toMatchObject({ code: 'CONFLICT' });

      const queue = await review().queue('WAITING');
      expect(queue).toEqual([expect.objectContaining({ technicianId: tech.id, level: 'SEMI_SKILLED', videoWaiting: true })]);
      const detail = await review().detail(tech.id);
      expect(detail.videos[0]).toMatchObject({ status: 'PENDING', durationSec: 95, url: expect.stringContaining(good) });
      await expect(review().decideVideo(detail.videos[0]!.id, 'APPROVE', ['AC'], '', HQ)).rejects.toMatchObject({ code: 'VALIDATION' });
      await review().decideVideo(detail.videos[0]!.id, 'APPROVE', ['CLEANING'], 'Clear work', HQ);
      await expect(review().decideVideo(detail.videos[0]!.id, 'REJECT', [], 'again', HQ)).rejects.toMatchObject({ code: 'CONFLICT' });

      const after = await skills();
      expect(after.video).toMatchObject({ status: 'APPROVED', categoryIds: ['CLEANING'] });
      expect(after.trades.map((x: { categoryId: string; verifiedVia: string | null }) => [x.categoryId, x.verifiedVia])).toEqual([['PLUMBING', null], ['CLEANING', 'VIDEO']]);
      expect((await me()).verification).toBe('APPROVED');
      expect(await review().queue('WAITING')).toEqual([]);

      // HQ can withdraw a trade (no more offers for it) or verify one itself.
      await review().decideTrade(tech.id, 'CLEANING', false, 'Video was not theirs', HQ);
      await review().decideTrade(tech.id, 'PLUMBING', true, 'Tested in person', HQ);
      expect((await me()).skillCheck.verifiedSkills).toEqual(['PLUMBING']);
    });

    it('keeps up to 4 certificates; approved ones show on the profile, the ID card and the QR check', async () => {
      const ids: string[] = [];
      for (let i = 0; i < 4; i++) {
        t.clock.advance(SEC);
        const uploadId = await upload('documents', pdf(), 'application/pdf');
        const res = (await api().post('/v1/tech/skills/certificates').set(as(tech.token)).send({ kind: i === 0 ? 'ITI' : 'OTHER', title: `Cert ${i}`, uploadId }).expect(200)).body;
        ids.push(res.certificates[i].id);
      }
      const fifth = await upload('documents', pdf(), 'application/pdf');
      await api().post('/v1/tech/skills/certificates').set(as(tech.token)).send({ kind: 'SKILL_INDIA', uploadId: fifth }).expect(409);
      const removed = (await api().delete(`/v1/tech/skills/certificates/${ids[3]}`).set(as(tech.token)).expect(200)).body;
      expect(removed.certificates).toHaveLength(3);
      await api().post('/v1/tech/skills/certificates').set(as(tech.token)).send({ kind: 'SKILL_INDIA', sample: true }).expect(422); // demo only

      await review().decideCertificate(ids[0]!, 'APPROVE', '', HQ);
      // Approved by Housefi: it stays (it is on the profile and the ID card).
      await api().delete(`/v1/tech/skills/certificates/${ids[0]}`).set(as(tech.token)).expect(409);
      await review().decideCertificate(ids[1]!, 'REJECT', 'Blurred photo', HQ);
      expect((await skills()).certificates.map((c: { status: string; reviewNote: string | null }) => [c.status, c.reviewNote])).toEqual([['APPROVED', null], ['REJECTED', 'Blurred photo'], ['PENDING', null]]);
      expect((await me()).skillCheck.certifications).toEqual([{ kind: 'ITI', title: 'Cert 0' }]);
      const card = (await api().get('/v1/tech/id-card').set(as(tech.token)).expect(200)).body;
      expect(card).toMatchObject({ certifications: [{ kind: 'ITI', title: 'Cert 0' }], verifiedSkills: [] });
      // The QR check shows them only while the technician may work.
      const token = card.verifyUrl.split('#').pop()!.split('/').pop()!;
      expect((await api().get(`/v1/verify/technicians/${token}`).expect(200)).body).toMatchObject({ active: false, certifications: [] });
    });

    it('lets the team\'s demo accounts use a sample video and certificate (the exam stays real)', async () => {
      await t.prisma.user.update({ where: { id: tech.id }, data: { isDemo: true } });
      await api().put('/v1/tech/skills/level').set(as(tech.token)).send({ level: 'SKILLED' }).expect(200);
      expect((await api().post('/v1/tech/skills/video').set(as(tech.token)).send({ source: 'SAMPLE' }).expect(200)).body.video).toMatchObject({ source: 'SAMPLE', status: 'PENDING' });
      expect((await api().post('/v1/tech/skills/certificates').set(as(tech.token)).send({ kind: 'SKILL_INDIA', sample: true }).expect(200)).body.certificates[0]).toMatchObject({ sample: true, status: 'PENDING' });
      const exam = await takeExam(await start(), 5);
      expect(exam.result).toMatchObject({ correct: 5, passed: false });
      // Demo accounts can try again after a minute.
      expect((await start('PLUMBING', 409)).error.retryAfterSec).toBe(60);
    });
  });

  describe('technicians from before the skill check', () => {
    it('keep working; a trade added later needs the skill check', async () => {
      // As the migration left them: every trade verified (EARLIER), then approved.
      const old = await createTechnician(t, '9876500022', { approve: false });
      await t.prisma.technicianSkill.updateMany({ where: { technicianId: old.id }, data: { verifiedAt: new Date(t.clock.now()), verifiedVia: 'EARLIER' } });
      await t.app.get(TechVerificationService).approve(old.id, { type: 'ADMIN', id: null, via: 'test' });
      const profile = (await api().get('/v1/tech/me').set(as(old.token)).expect(200)).body;
      expect(profile).toMatchObject({ verification: 'APPROVED', skillCheck: { level: null, required: false, verifiedSkills: ['PLUMBING', 'CLEANING'] } });
      // Editing the profile keeps the kept trades' verification; the new one starts unverified.
      const edited = (await api().put('/v1/tech/profile').set(as(old.token)).send({ ...profileOf(profile), skills: ['PLUMBING', 'AC'] }).expect(200)).body;
      expect(edited.skillCheck).toMatchObject({ required: true, verifiedSkills: ['PLUMBING'] });
    });
  });

  it('account deletion removes the skill check', async () => {
    await api().put('/v1/tech/skills/level').set(as(tech.token)).send({ level: 'SKILLED' }).expect(200);
    await start();
    const video = await upload('videos', mp4Video(70), 'video/mp4');
    await api().post('/v1/tech/skills/video').set(as(tech.token)).send({ source: 'UPLOAD', uploadId: video }).expect(200);
    await api().delete('/v1/me').set(as(tech.token)).expect(204);
    expect(await t.prisma.skillExamAttempt.count()).toBe(0);
    expect(await t.prisma.skillVideo.count()).toBe(0);
    expect(t.store.objects.has(`v/${video}`)).toBe(false);
  });
});

function profileOf(p: Record<string, unknown>) {
  const { name, gender, experienceYears, skills, pincode, city, areas, vehicle } = p;
  return { name, gender, experienceYears, skills, pincode, city, areas, vehicle };
}
