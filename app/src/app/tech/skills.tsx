// The skill check, after the Aadhaar scan (registration step 3 of 3), and later from the profile: the technician chooses
// their level (it sets how hard the exam is), takes the exam for each trade, and may add a 1-2 minute work video and up
// to 4 certificates. At least an exam or a video is needed to send it; the review time starts when it is sent. Jobs
// come only for verified trades (a passed exam, a video Housefi approved, or Housefi itself). The team's demo accounts
// may use a sample video and certificate; their exam is the real one.
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { CATEGORIES } from '../../data/catalog';
import { techHref } from '../../domain/techReview';
import type { CategoryId, CertificateKind, SkillCheck, SkillLevel, SkillTrade } from '../../domain/types';
import { Art3D } from '../../illustrations/Art3D';
import { formatClock, formatDate, sameDay } from '../../i18n/format';
import { useI18n, type StringKey } from '../../i18n/I18n';
import { resetTo } from '../../navigation';
import { isApiError } from '../../services/api';
import { pickPdf, pickPhoto, pickVideo } from '../../services/device';
import { feedback } from '../../services/feedback';
import { useBackend } from '../../services/ServicesProvider';
import { useAppState, useTechSession } from '../../state/AppState';
import { colors, radius, space } from '../../theme/tokens';
import { Banner, Button, Card, ErrorBanner, Field, Header, Icon, Pill, Screen, Segmented, Sheet, Skeleton, Tap, Txt, useToast } from '../../ui';
import { ChoiceCard } from '../../ui/ChoiceCard';

const LEVELS: readonly SkillLevel[] = ['UNSKILLED', 'SEMI_SKILLED', 'SKILLED', 'HIGHLY_SKILLED'];
const LEVEL_ART = { UNSKILLED: 'sparkles', SEMI_SKILLED: 'star', SKILLED: 'tools', HIGHLY_SKILLED: 'trophy' } as const;
const KINDS: readonly CertificateKind[] = ['ITI', 'SKILL_INDIA', 'OTHER'];

export default function SkillCheckScreen() {
  const { t, l, locale } = useI18n();
  const backend = useBackend();
  const session = useTechSession();
  const { updateTech } = useAppState();
  const toast = useToast();
  const [check, setCheck] = useState<SkillCheck | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [certOpen, setCertOpen] = useState(false);
  const [kind, setKind] = useState<CertificateKind>('ITI');
  const [title, setTitle] = useState('');
  // During registration this is a step (no way back); from the profile it is a normal page.
  const [registering] = useState(() => session.profile.skillCheck?.required === true && session.profile.verification === 'PENDING');

  const load = useCallback(() => {
    let alive = true;
    void backend.tech.skills(session.token).then((c) => {
      if (alive) setCheck(c);
    }).catch((e: unknown) => {
      if (alive) setError(e);
    });
    return () => {
      alive = false;
    };
  }, [backend, session.token]);
  // Again on every return (from the exam, the camera).
  useFocusEffect(load);

  const run = async (what: string, fn: () => Promise<SkillCheck | void>) => {
    setBusy(what);
    setError(null);
    try {
      const next = await fn();
      if (next) setCheck(next);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(null);
    }
  };

  const when = (ms: number) => {
    const d = new Date(ms);
    return sameDay(d, new Date()) ? formatClock(d, locale) : `${formatDate(d, locale)}, ${formatClock(d, locale)}`;
  };

  const started = !!check && check.trades.some((x) => x.exam.state !== 'NONE');

  const startExam = (categoryId: CategoryId) =>
    run(`exam-${categoryId}`, async () => {
      const exam = await backend.tech.startExam(session.token, categoryId);
      router.push({ pathname: '/tech/exam/[id]', params: { id: exam.id } });
    });

  const chooseVideo = () =>
    run('video-upload', async () => {
      const r = await pickVideo();
      if (!r.ok) return;
      if (r.durationSec !== null && r.durationSec < 55) return toast.show(t('skills.videoTooShort'));
      if (r.durationSec !== null && r.durationSec > 125) return toast.show(t('skills.videoTooLong'));
      try {
        return await backend.tech.sendSkillVideo(session.token, { source: 'UPLOAD', uri: r.uri });
      } catch (e) {
        if (isApiError(e, 'VALIDATION')) toast.show(t('skills.videoTooBig'));
        throw e;
      }
    });

  const addCertificate = (from: 'photo' | 'pdf' | 'sample') =>
    run(`cert-${from}`, async () => {
      const base = { kind, title: title.trim() };
      let next: SkillCheck;
      if (from === 'sample') next = await backend.tech.addCertificate(session.token, { ...base, sample: true });
      else if (from === 'photo') {
        const r = await pickPhoto('gallery');
        if (!r.ok) return;
        next = await backend.tech.addCertificate(session.token, { ...base, uri: r.uri, mimeType: 'image/jpeg' });
      } else {
        const r = await pickPdf();
        if (!r.ok) return;
        next = await backend.tech.addCertificate(session.token, { ...base, uri: r.uri, mimeType: r.mimeType });
      }
      setCertOpen(false);
      setTitle('');
      feedback('success');
      return next;
    });

  const send = () =>
    run('send', async () => {
      const next = await backend.tech.submitSkills(session.token);
      const profile = await backend.tech.me(session.token);
      updateTech(profile);
      feedback('success');
      if (registering) resetTo(techHref(profile, Date.now()));
      return next;
    });

  const tradeRow = (x: SkillTrade) => {
    const cat = CATEGORIES.find((c) => c.id === x.categoryId);
    const e = x.exam;
    return (
      <Card key={x.categoryId} style={styles.trade} testID={`skills-trade-${x.categoryId}`}>
        <View style={styles.row}>
          {cat ? <Art3D name={cat.art} size={44} /> : null}
          <View style={styles.flex}>
            <Txt variant="bodyStrong">{cat ? l(cat.name) : x.categoryId}</Txt>
            {x.verifiedVia ? <Pill tone="success" icon="checkmark-circle" label={t(`skills.via.${x.verifiedVia}` as StringKey)} />
              : e.state === 'FAILED' && e.points !== null ? <Pill tone="warning" label={t('skills.examFailed', { points: e.points, max: e.maxPoints })} />
                : <Txt variant="footnote" color="inkMuted">{t('skills.notVerified')}</Txt>}
            {x.verifiedVia === 'EXAM' && e.points !== null ? <Txt variant="footnote" color="inkMuted">{t('skills.examPassed', { points: e.points, max: e.maxPoints })}</Txt> : null}
          </View>
        </View>
        {x.verifiedVia ? null : e.state === 'IN_PROGRESS' && e.attemptId ? (
          <Button label={t('skills.examContinue')} icon="play" size="md" onPress={() => router.push({ pathname: '/tech/exam/[id]', params: { id: e.attemptId! } })} testID={`skills-continue-${x.categoryId}`} />
        ) : e.retakeAt ? (
          <Txt variant="footnote" color="inkMuted" testID={`skills-retake-${x.categoryId}`}>{t('skills.retakeAt', { when: when(e.retakeAt) })}</Txt>
        ) : (
          <Button label={t('skills.examStart')} icon="school-outline" size="md" variant={check?.level ? 'primary' : 'secondary'} disabled={!check?.level}
            loading={busy === `exam-${x.categoryId}`} onPress={() => void startExam(x.categoryId)} testID={`skills-start-${x.categoryId}`} />
        )}
      </Card>
    );
  };

  const video = check?.video ?? null;
  const live = (check?.certificates ?? []).filter((c) => c.status !== 'REJECTED').length;

  return (
    <Screen
      testID="tech-skills"
      wash="sky"
      header={<Header title={t('skills.title')} back={!registering} />}
      footer={check && check.submittedAt === null ? (
        <>
          {!check.canSubmit ? <Txt variant="footnote" color="inkMuted" align="center">{check.level ? t('skills.needOne') : t('skills.chooseLevel')}</Txt> : null}
          <Button label={t('skills.send')} trailingIcon="send" disabled={!check.canSubmit} loading={busy === 'send'} onPress={() => void send()} testID="skills-send" />
        </>
      ) : check && registering ? (
        <Button label={t('common.continue')} trailingIcon="arrow-forward" onPress={() => resetTo(techHref(session.profile, Date.now()))} testID="skills-continue" />
      ) : undefined}
    >
      {registering ? <Txt variant="label" color="inkMuted">{t('skills.step')}</Txt> : null}
      <Txt variant="body" color="inkMuted">{t('skills.intro')}</Txt>
      {check?.demo ? <Banner tone="info" icon="flask-outline" text={t('skills.demo')} testID="skills-demo" /> : null}
      {check?.submittedAt != null ? <Banner tone="success" icon="checkmark-circle" text={`${t('skills.sentTitle')}. ${t('skills.sentBody')}`} testID="skills-sent" /> : null}
      <ErrorBanner error={error} />

      {!check ? <Skeleton style={styles.skeleton} /> : (
        <>
          <View style={styles.block}>
            <Txt variant="title3" heading>{t('skills.levelTitle')}</Txt>
            <Txt variant="footnote" color="inkMuted">{t('skills.levelHint')}</Txt>
            {LEVELS.filter((lv) => !started || lv === check.level).map((lv) => (
              <ChoiceCard key={lv} title={t(`skills.level.${lv}` as StringKey)} subtitle={t(`skills.level.${lv}.body` as StringKey)}
                art={<Art3D name={LEVEL_ART[lv]} size={40} />} selected={check.level === lv}
                onPress={() => (started || busy ? undefined : void run(`level-${lv}`, () => backend.tech.setSkillLevel(session.token, lv)))} testID={`skills-level-${lv}`} />
            ))}
          </View>

          <View style={styles.block}>
            <Txt variant="title3" heading>{t('skills.examsTitle')}</Txt>
            <Txt variant="footnote" color="inkMuted">{t('skills.examRules')}</Txt>
            {check.trades.map(tradeRow)}
          </View>

          <View style={styles.block}>
            <View style={styles.row}>
              <Txt variant="title3" heading style={styles.flex}>{t('skills.videoTitle')}</Txt>
              <Pill label={t('skills.optional')} />
            </View>
            <Txt variant="footnote" color="inkMuted">{t('skills.videoHint')}</Txt>
            {video ? (
              <Card style={styles.row} testID={`skills-video-${video.status}`}>
                <Icon name={video.status === 'APPROVED' ? 'checkmark-circle' : video.status === 'REJECTED' ? 'alert-circle' : 'time-outline'} size={22}
                  color={video.status === 'APPROVED' ? 'success' : video.status === 'REJECTED' ? 'warning' : 'navy'} />
                <View style={styles.flex}>
                  <Txt variant="bodyStrong">{t(`skills.video.${video.status}` as StringKey)}</Txt>
                  {video.reviewNote ? <Txt variant="footnote" color="inkMuted">{video.reviewNote}</Txt> : null}
                </View>
              </Card>
            ) : null}
            {video?.status !== 'APPROVED' ? (
              <View style={styles.buttons}>
                <Button label={t('skills.videoRecord')} icon="videocam" size="md" style={styles.flex} onPress={() => router.push('/tech/skill-video')} testID="skills-video-record" />
                <Button label={t('skills.videoUpload')} icon="images-outline" size="md" variant="outline" style={styles.flex} loading={busy === 'video-upload'} onPress={() => void chooseVideo()} testID="skills-video-upload" />
              </View>
            ) : null}
            {busy === 'video-upload' ? <Txt variant="footnote" color="inkMuted" align="center">{t('skills.uploading')}</Txt> : null}
            {check.demo && video?.status !== 'APPROVED' ? (
              <Button label={t('skills.videoSample')} icon="film-outline" size="md" variant="ghost" loading={busy === 'video-sample'}
                onPress={() => void run('video-sample', () => backend.tech.sendSkillVideo(session.token, { source: 'SAMPLE' }))} testID="skills-video-sample" />
            ) : null}
          </View>

          <View style={styles.block}>
            <View style={styles.row}>
              <Txt variant="title3" heading style={styles.flex}>{t('skills.certTitle')}</Txt>
              <Pill label={t('skills.optional')} />
            </View>
            <Txt variant="footnote" color="inkMuted">{t('skills.certHint', { max: check.rules.maxCertificates })}</Txt>
            {check.certificates.map((c) => (
              <Card key={c.id} style={styles.row} testID={`skills-cert-${c.status}`}>
                <Icon name="ribbon-outline" size={22} color="navy" />
                <View style={styles.flex}>
                  <Txt variant="bodyStrong" numberOfLines={1}>{c.title || t(`skills.cert.${c.kind}` as StringKey)}</Txt>
                  <Pill tone={c.status === 'APPROVED' ? 'success' : c.status === 'REJECTED' ? 'danger' : 'info'} label={t(`skills.certStatus.${c.status}` as StringKey)} />
                  {c.reviewNote ? <Txt variant="footnote" color="inkMuted">{c.reviewNote}</Txt> : null}
                </View>
                {/* Approved by Housefi: it stays on the profile and ID card (it cannot be removed). */}
                {c.status === 'APPROVED' ? (
                  <View accessible accessibilityLabel={t('skills.certLocked')} testID={`skills-cert-locked-${c.id}`}><Icon name="lock-closed" size={18} color="inkMuted" /></View>
                ) : (
                  <Tap onPress={() => void run(`remove-${c.id}`, () => backend.tech.removeCertificate(session.token, c.id))} accessibilityLabel={t('common.remove')} testID={`skills-cert-remove-${c.id}`}>
                    <Icon name="trash-outline" size={20} color="inkMuted" />
                  </Tap>
                )}
              </Card>
            ))}
            {live < check.rules.maxCertificates ? (
              <Button label={t('skills.certAdd')} icon="add" size="md" variant="outline" onPress={() => setCertOpen(true)} testID="skills-cert-add" />
            ) : null}
          </View>
        </>
      )}

      <Sheet visible={certOpen} onClose={() => setCertOpen(false)} testID="skills-cert-sheet">
        <Txt variant="title2" heading>{t('skills.certAdd')}</Txt>
        <Txt variant="label">{t('skills.certKind')}</Txt>
        <Segmented value={kind} onChange={setKind} options={KINDS.map((k) => ({ value: k, label: t(`skills.cert.${k}` as StringKey) }))} />
        <Field label={t('skills.certName')} value={title} onChangeText={setTitle} maxLength={80} testID="skills-cert-title" />
        <View style={styles.buttons}>
          <Button label={t('skills.certPhoto')} icon="image-outline" size="md" style={styles.flex} loading={busy === 'cert-photo'} onPress={() => void addCertificate('photo')} testID="skills-cert-photo" />
          <Button label={t('skills.certPdf')} icon="document-outline" size="md" variant="outline" style={styles.flex} loading={busy === 'cert-pdf'} onPress={() => void addCertificate('pdf')} testID="skills-cert-pdf" />
        </View>
        {check?.demo ? <Button label={t('skills.certSample')} icon="ribbon-outline" size="md" variant="ghost" loading={busy === 'cert-sample'} onPress={() => void addCertificate('sample')} testID="skills-cert-sample" /> : null}
        <ErrorBanner error={error} />
      </Sheet>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  block: { gap: space.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  buttons: { flexDirection: 'row', gap: space.sm },
  skeleton: { height: 320, borderRadius: radius.lg },
  trade: { gap: space.md, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.line },
});
