// The skill exam: 10 questions in 3 timed parts (3 questions in 3 min, 3 picture questions in 4, 4 "choose the right
// part or tool" in 5). Simple on purpose: Question 1 → Next / Back → Question 10 → Submit. Back works inside the open
// part only (opening the next part closes the one before). The server keeps the time and the answers and marks the
// paper; the screen only shows them (its clock follows the server's). Screenshots are blocked (as on the ID card);
// leaving the app is counted, and the third time submits the exam. The questions can be read in English or Telugu
// (the app's language first). The result shows at once, then the skill check continues by itself after 10 seconds.
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, StyleSheet, View } from 'react-native';
import { CATEGORIES } from '../../../data/catalog';
import type { ExamQuestion, SkillExam } from '../../../domain/types';
import { Art3D } from '../../../illustrations/Art3D';
import { SkillArt } from '../../../illustrations/SkillArt';
import { formatClock, formatDate, formatDuration, sameDay, type Locale } from '../../../i18n/format';
import { I18nProvider, useI18n, type StringKey } from '../../../i18n/I18n';
import { isApiError } from '../../../services/api';
import { feedback } from '../../../services/feedback';
import { useBackend } from '../../../services/ServicesProvider';
import { useTechSession } from '../../../state/AppState';
import { colors, radius, space } from '../../../theme/tokens';
import { Banner, Button, Card, ConfirmSheet, ErrorBanner, Header, Icon, Pill, Screen, Segmented, Skeleton, Tap, Txt } from '../../../ui';
import { Celebrate } from '../../../ui/motion';
import { IdCardShield } from '../../../ui/TechIdentity';

const AUTO_CONTINUE_SEC = 10;

export default function ExamScreen() {
  const app = useI18n();
  // The exam's own language switch, starting with the app's.
  const [lang, setLang] = useState<Locale>(app.locale);
  return (
    <IdCardShield>
      <Stack.Screen options={{ gestureEnabled: false }} />
      <I18nProvider locale={lang}>
        <Exam lang={lang} setLang={setLang} />
      </I18nProvider>
    </IdCardShield>
  );
}

function Exam({ lang, setLang }: { readonly lang: Locale; readonly setLang: (l: Locale) => void }) {
  const { t, l } = useI18n();
  const { id } = useLocalSearchParams<{ id: string }>();
  const backend = useBackend();
  const session = useTechSession();
  const [exam, setExam] = useState<SkillExam | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [index, setIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<'PART' | 'SUBMIT' | null>(null);
  const [left, setLeft] = useState(0);
  // Server time minus phone time, so the timer is right even when the phone's clock is not.
  const offset = useRef(0);
  const [now, setNow] = useState(() => Date.now());

  const take = useCallback((e: SkillExam) => {
    offset.current = e.serverNow - Date.now();
    setExam(e);
    setNow(Date.now() + offset.current);
  }, []);

  const call = useCallback(async (fn: () => Promise<SkillExam>) => {
    setError(null);
    try {
      take(await fn());
    } catch (e) {
      // Time ran out on the server first: show the paper as it stands now.
      if (isApiError(e, 'CONFLICT')) take(await backend.tech.exam(session.token, id));
      else setError(e);
    }
  }, [backend, session.token, id, take]);

  useEffect(() => {
    void call(() => backend.tech.exam(session.token, id));
  }, [backend, session.token, id, call]);

  const running = exam?.state === 'IN_PROGRESS';

  // The clock, every half second while the exam runs.
  useEffect(() => {
    if (!running) return undefined;
    const tick = setInterval(() => setNow(Date.now() + offset.current), 500);
    return () => clearInterval(tick);
  }, [running]);

  // Leaving the app during the exam is counted by the server (the third time submits it).
  useEffect(() => {
    if (!running || !exam) return undefined;
    let away = false;
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'background' && !away) {
        away = true;
        void backend.tech.examLeftApp(session.token, exam.id).then((e) => {
          take(e);
          setLeft(e.leftApp);
        }).catch(() => undefined);
      } else if (s === 'active') away = false;
    });
    return () => sub.remove();
  }, [running, exam, backend, session.token, take]);

  const section = exam?.currentSection ?? -1;
  const sec = exam && section >= 0 ? exam.sections[section] : null;
  const timeLeft = sec?.endsAt != null ? Math.max(0, Math.ceil((sec.endsAt - now) / 1000)) : null;
  const inSection = exam ? exam.questions.filter((q) => q.section === section) : [];
  const q: ExamQuestion | undefined = inSection[index];

  const openSection = useCallback(async (n: number) => {
    if (!exam) return;
    setBusy(true);
    await call(() => backend.tech.startExamSection(session.token, exam.id, n));
    setIndex(0);
    setBusy(false);
  }, [exam, backend, session.token, call]);

  const submit = useCallback(async () => {
    if (!exam) return;
    setBusy(true);
    await call(() => backend.tech.submitExam(session.token, exam.id));
    setBusy(false);
  }, [exam, backend, session.token, call]);

  // A part's time is up: the next part opens (the last one submits).
  const timedOut = useRef<number | null>(null);
  useEffect(() => {
    if (!running || timeLeft !== 0 || timedOut.current === section) return;
    timedOut.current = section;
    feedback('warning');
    setConfirm(null);
    void (section < 2 ? openSection(section + 1) : submit());
  }, [running, timeLeft, section, openSection, submit]);

  const answer = (optionId: string) => {
    if (!exam || !q || busy) return;
    feedback('pop');
    // Shown at once; the server's copy replaces it.
    setExam({ ...exam, answers: { ...exam.answers, [q.id]: optionId } });
    void call(() => backend.tech.answerExam(session.token, exam.id, q.id, optionId));
  };

  if (!exam) {
    return (
      <Screen testID="tech-exam" header={<Header title={t('skills.title')} back={false} />}>
        <ErrorBanner error={error} />
        {!error ? <Skeleton style={styles.skeleton} /> : <Button label={t('common.back')} variant="outline" onPress={() => router.back()} />}
      </Screen>
    );
  }

  const cat = CATEGORIES.find((c) => c.id === exam.categoryId);
  const title = t('exam.title', { trade: cat ? l(cat.name) : exam.categoryId });

  if (exam.result) return <Result exam={exam} title={title} />;

  const langSwitch = (
    <View style={styles.lang}>
      <Txt variant="caption" color="inkMuted">{t('exam.lang')}</Txt>
      <Segmented value={lang} onChange={setLang} options={[{ value: 'en', label: 'English' }, { value: 'te', label: 'తెలుగు' }]} />
    </View>
  );

  // Before the first part: the rules.
  if (section < 0) {
    return (
      <Screen testID="tech-exam" wash="sky" header={<Header title={title} back />}
        footer={<Button label={t('exam.begin')} trailingIcon="arrow-forward" loading={busy} onPress={() => void openSection(0)} testID="exam-begin" />}>
        {langSwitch}
        <View style={styles.center}><Art3D name="clipboard" size={96} float /></View>
        <Txt variant="title2" heading>{t('exam.rules')}</Txt>
        {exam.sections.map((s, i) => (
          <Card key={s.type} style={styles.row}>
            <View style={styles.num}><Txt variant="label" color="onNavy">{i + 1}</Txt></View>
            <View style={styles.flex}>
              <Txt variant="bodyStrong">{t(`exam.part.${s.type}` as StringKey)}</Txt>
              <Txt variant="footnote" color="inkMuted">{t(`exam.partIntro.${s.type}` as StringKey)}</Txt>
            </View>
          </Card>
        ))}
        {(['exam.rule1', 'exam.rule2', 'exam.rule3', 'exam.rule4'] as const).map((k) => (
          <View key={k} style={styles.row}><Icon name="checkmark-circle" size={18} color="navy" /><Txt variant="callout" style={styles.flex}>{t(k)}</Txt></View>
        ))}
        <ErrorBanner error={error} />
      </Screen>
    );
  }

  const number = exam.questions.findIndex((x) => x.id === q?.id) + 1;
  const lastInSection = index === inSection.length - 1;
  const lastSection = section === exam.sections.length - 1;
  const unanswered = (lastSection ? exam.questions : inSection).filter((x) => !exam.answers[x.id] && x.section >= section).length;
  const chosen = q ? exam.answers[q.id] ?? null : null;
  const chosenArt = q && chosen ? q.options.find((o) => o.id === chosen)?.art ?? null : null;
  const urgent = timeLeft !== null && timeLeft <= 30;

  return (
    <Screen
      testID="tech-exam"
      header={<Header title={title} back={false} />}
      footer={(
        <View style={styles.nav}>
          <Button label={t('exam.back')} icon="arrow-back" variant="outline" size="md" style={styles.flex} disabled={index === 0 || busy} onPress={() => setIndex(index - 1)} testID="exam-back" />
          {!lastInSection ? (
            <Button label={t('exam.next')} trailingIcon="arrow-forward" size="md" style={styles.flex} disabled={busy} onPress={() => setIndex(index + 1)} testID="exam-next" />
          ) : lastSection ? (
            <Button label={t('exam.submit')} icon="checkmark-done" variant="lime" size="md" style={styles.flex} loading={busy} onPress={() => setConfirm('SUBMIT')} testID="exam-submit" />
          ) : (
            <Button label={t('exam.nextPart')} trailingIcon="arrow-forward" size="md" style={styles.flex} loading={busy} onPress={() => setConfirm('PART')} testID="exam-next-part" />
          )}
        </View>
      )}
    >
      <View style={styles.top}>
        <View style={styles.flex}>
          <Txt variant="label" color="inkMuted">{t('exam.part', { n: section + 1 })} · {t(`exam.part.${exam.sections[section]!.type}` as StringKey)}</Txt>
          <Txt variant="title3" heading testID="exam-number">{t('exam.question', { n: number, total: exam.questions.length })}</Txt>
        </View>
        {timeLeft !== null ? (
          <View style={[styles.timer, urgent && styles.timerUrgent]} testID="exam-timer">
            <Icon name="time-outline" size={16} color={urgent ? 'onNavy' : 'navy'} />
            <Txt variant="label" color={urgent ? 'onNavy' : 'navy'}>{formatDuration(timeLeft)}</Txt>
          </View>
        ) : null}
      </View>
      <View style={styles.dots}>
        {exam.questions.map((x, i) => (
          <View key={x.id} style={[styles.dot, exam.answers[x.id] ? styles.dotDone : null, x.id === q?.id ? styles.dotNow : null, x.section < section ? styles.dotClosed : null]} />
        ))}
      </View>
      {langSwitch}
      {left > 0 ? <Banner tone="warning" icon="alert-circle" text={t('exam.leftWarn', { n: left, max: exam.maxLeftApp })} testID="exam-left-warning" /> : null}
      <ErrorBanner error={error} />

      {q ? (
        <>
          <Txt variant="title2" heading lang={lang} testID="exam-question">{q.q[lang]}</Txt>
          {q.art ? (
            <Card style={styles.art}>
              <SkillArt id={q.art} size={300} highlight={q.type === 'DIAGRAM' && chosenArt ? chosenArt.slice(-1) : null} placed={q.type === 'SELECT' ? chosenArt : null} />
            </Card>
          ) : null}
          {q.type === 'DIAGRAM' ? (
            <View style={styles.letters}>
              {q.options.map((o) => {
                const on = chosen === o.id;
                return (
                  <Tap key={o.id} onPress={() => answer(o.id)} style={[styles.letter, on && styles.optionOn]} accessibilityRole="radio" accessibilityState={{ selected: on }} haptic testID={`exam-option-${o.id}`}>
                    <Txt variant="title2" color={on ? 'onNavy' : 'navy'}>{(o.art ?? '').slice(-1)}</Txt>
                  </Tap>
                );
              })}
            </View>
          ) : q.type === 'SELECT' ? (
            <View style={styles.grid}>
              {q.options.map((o) => {
                const on = chosen === o.id;
                return (
                  <Tap key={o.id} onPress={() => answer(o.id)} style={[styles.tile, on && styles.tileOn]} accessibilityRole="radio" accessibilityState={{ selected: on }} accessibilityLabel={o[lang] ?? ''} haptic testID={`exam-option-${o.id}`}>
                    {o.art ? <SkillArt id={o.art} size={64} /> : null}
                    <Txt variant="callout" align="center" lang={lang} weight={on ? 'bold' : 'medium'} numberOfLines={2}>{o[lang] ?? ''}</Txt>
                    {on ? <View style={styles.tick}><Icon name="checkmark" size={14} color="onNavy" /></View> : null}
                  </Tap>
                );
              })}
            </View>
          ) : (
            <View style={styles.options}>
              {q.options.map((o, i) => {
                const on = chosen === o.id;
                return (
                  <Tap key={o.id} onPress={() => answer(o.id)} style={[styles.option, on && styles.optionOn]} accessibilityRole="radio" accessibilityState={{ selected: on }} haptic testID={`exam-option-${o.id}`}>
                    <View style={[styles.optionKey, on && styles.optionKeyOn]}><Txt variant="label" color={on ? 'navy' : 'inkMuted'}>{'ABCDEF'[i]}</Txt></View>
                    <Txt variant="body" color={on ? 'onNavy' : 'ink'} lang={lang} style={styles.flex}>{o[lang] ?? ''}</Txt>
                  </Tap>
                );
              })}
            </View>
          )}
        </>
      ) : null}

      <ConfirmSheet
        visible={confirm !== null}
        title={confirm === 'SUBMIT' ? t('exam.confirmSubmit') : t('exam.confirmPart')}
        body={unanswered > 0 ? t('exam.unanswered', { n: unanswered }) : confirm === 'PART' ? t('exam.noComeBack') : undefined}
        icon={confirm === 'SUBMIT' ? 'checkmark-done' : 'arrow-forward'}
        confirmLabel={confirm === 'SUBMIT' ? t('exam.submit') : t('exam.nextPart')}
        busy={busy}
        onCancel={() => setConfirm(null)}
        onConfirm={() => {
          const what = confirm;
          setConfirm(null);
          void (what === 'SUBMIT' ? submit() : openSection(section + 1));
        }}
      />
    </Screen>
  );
}

/** The result, right after the exam; the skill check comes back by itself after 10 seconds. */
function Result({ exam, title }: { readonly exam: SkillExam; readonly title: string }) {
  const { t, l, locale } = useI18n();
  const r = exam.result!;
  const [count, setCount] = useState(AUTO_CONTINUE_SEC);
  const done = useRef(false);
  const leave = useCallback(() => {
    if (done.current) return;
    done.current = true;
    if (router.canGoBack()) router.back();
    else router.replace('/tech/skills');
  }, []);

  useEffect(() => {
    feedback(r.passed ? 'success' : 'warning');
  }, [r.passed]);
  useEffect(() => {
    const tick = setInterval(() => setCount((c) => c - 1), 1000);
    return () => clearInterval(tick);
  }, []);
  useEffect(() => {
    if (count <= 0) leave();
  }, [count, leave]);

  const cat = CATEGORIES.find((c) => c.id === exam.categoryId);
  const retake = r.retakeAt ? new Date(r.retakeAt) : null;
  const retakeText = retake ? (sameDay(retake, new Date()) ? formatClock(retake, locale) : `${formatDate(retake, locale)}, ${formatClock(retake, locale)}`) : null;

  return (
    <Screen testID="tech-exam-result" wash={r.passed ? 'mint' : 'peach'} header={<Header title={title} back={false} />}
      footer={<Button label={`${t('exam.continue')} · ${t('exam.continueIn', { s: Math.max(0, count) })}`} trailingIcon="arrow-forward" onPress={leave} testID="exam-continue" />}>
      <View style={styles.center}>
        {r.passed ? <Celebrate size={130}><Art3D name="trophy" size={120} /></Celebrate> : <Art3D name="verify_fix" size={110} float />}
        <Txt variant="title1" align="center" heading testID={r.passed ? 'exam-passed' : 'exam-failed'}>{r.passed ? t('exam.passed') : t('exam.failed')}</Txt>
        <Txt variant="price" color={r.passed ? 'success' : 'warning'} testID="exam-points">{t('exam.score', { points: r.points, max: r.maxPoints })}</Txt>
        <View style={styles.pills}>
          <Pill tone="info" label={t('exam.correct', { n: r.correct, total: r.total })} />
          {r.bonusPoints > 0 ? <Pill tone="success" icon="flash" label={t('exam.bonus', { n: r.bonusPoints })} /> : null}
          <Pill label={t('exam.need', { points: r.passPoints })} />
        </View>
      </View>
      {r.passed && cat ? <Banner tone="success" icon="checkmark-circle" text={t('exam.verifiedNow', { trade: l(cat.name) })} /> : null}
      {r.autoSubmitted ? <Banner tone="info" icon="time-outline" text={t('exam.auto')} /> : null}
      {retakeText ? <Banner tone="warning" icon="refresh" text={t('exam.retake', { when: retakeText })} testID="exam-retake" /> : null}
      <Card style={styles.marks}>
        {r.questions.map((m, i) => (
          <View key={m.questionId} style={styles.mark} accessibilityLabel={`${i + 1}: ${m.correct ? t('exam.right') : t('exam.wrong')}`}>
            <View style={[styles.markDot, m.correct ? styles.markRight : styles.markWrong]}>
              <Icon name={m.correct ? 'checkmark' : 'close'} size={14} color="onNavy" />
            </View>
            <Txt variant="caption" color="inkMuted">{i + 1}</Txt>
            {m.fast ? <Icon name="flash" size={12} color="success" /> : null}
          </View>
        ))}
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: { alignItems: 'center', gap: space.md, paddingVertical: space.md },
  skeleton: { height: 360, borderRadius: radius.lg },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  num: { width: 28, height: 28, borderRadius: 14, backgroundColor: colors.navy, alignItems: 'center', justifyContent: 'center' },
  lang: { gap: space.xs },
  top: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  timer: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: space.md, paddingVertical: space.sm, borderRadius: radius.pill, backgroundColor: colors.blueTint },
  timerUrgent: { backgroundColor: colors.danger },
  dots: { flexDirection: 'row', gap: 6 },
  dot: { flex: 1, height: 6, borderRadius: 3, backgroundColor: colors.line },
  dotDone: { backgroundColor: colors.cyan },
  dotNow: { backgroundColor: colors.navy },
  dotClosed: { opacity: 0.4 },
  art: { alignItems: 'center', padding: space.sm },
  options: { gap: space.sm },
  option: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md, borderRadius: radius.lg, backgroundColor: colors.surface, borderWidth: 1.5, borderColor: colors.line, minHeight: 56 },
  optionOn: { backgroundColor: colors.navy, borderColor: colors.navy },
  optionKey: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surfaceMuted },
  optionKeyOn: { backgroundColor: colors.onNavy },
  letters: { flexDirection: 'row', gap: space.md, justifyContent: 'space-between' },
  letter: { flex: 1, aspectRatio: 1, maxWidth: 80, borderRadius: radius.lg, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface, borderWidth: 2, borderColor: colors.navy },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  tile: { width: '48%', flexGrow: 1, alignItems: 'center', gap: space.xs, padding: space.md, borderRadius: radius.lg, backgroundColor: colors.surface, borderWidth: 2, borderColor: colors.line },
  tileOn: { borderColor: colors.navy, backgroundColor: colors.blueTint },
  tick: { position: 'absolute', top: 8, right: 8, width: 22, height: 22, borderRadius: 11, backgroundColor: colors.navy, alignItems: 'center', justifyContent: 'center' },
  nav: { flexDirection: 'row', gap: space.sm },
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, justifyContent: 'center' },
  marks: { flexDirection: 'row', flexWrap: 'wrap', gap: space.md, justifyContent: 'center' },
  mark: { alignItems: 'center', gap: 2 },
  markDot: { width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  markRight: { backgroundColor: colors.success },
  markWrong: { backgroundColor: colors.danger },
});
