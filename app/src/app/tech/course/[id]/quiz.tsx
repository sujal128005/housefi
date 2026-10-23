// The course quiz: 5 questions (options in a new order each try), 3 right to pass, as many tries as wanted. Passing
// completes the course and adds the Housefi course certificate to the profile and ID card.
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import type { CourseQuiz, CourseQuizResult } from '../../../../domain/types';
import { Art3D } from '../../../../illustrations/Art3D';
import { useI18n } from '../../../../i18n/I18n';
import { feedback } from '../../../../services/feedback';
import { useBackend } from '../../../../services/ServicesProvider';
import { useTechSession } from '../../../../state/AppState';
import { colors, radius, space } from '../../../../theme/tokens';
import { Banner, Button, ErrorBanner, Header, Icon, Screen, Skeleton, Tap, Txt } from '../../../../ui';
import { Celebrate } from '../../../../ui/motion';

export default function CourseQuizScreen() {
  const { t, locale } = useI18n();
  const { id } = useLocalSearchParams<{ id: string }>();
  const backend = useBackend();
  const session = useTechSession();
  const [quiz, setQuiz] = useState<CourseQuiz | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [result, setResult] = useState<CourseQuizResult | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [round, setRound] = useState(0);

  useEffect(() => {
    let alive = true;
    void backend.tech.courseQuiz(session.token, id).then((q) => {
      if (!alive) return;
      setQuiz(q);
      setAnswers({});
    }).catch((e: unknown) => alive && setError(e));
    return () => {
      alive = false;
    };
  }, [backend, session.token, id, round]);

  const complete = !!quiz && quiz.questions.every((q) => answers[String(q.n)]);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await backend.tech.submitCourseQuiz(session.token, id, answers);
      setResult(r);
      feedback(r.passed ? 'success' : 'warning');
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  if (result) {
    return (
      <Screen testID="tech-course-quiz-result" wash={result.passed ? 'mint' : 'peach'} header={<Header title={t('learn.quizTitle')} back={false} />}
        footer={result.passed ? <Button label={t('learn.backToCourse')} icon="ribbon" variant="lime" onPress={() => router.back()} testID="quiz-done" />
          : <Button label={t('learn.tryAgain')} icon="refresh" onPress={() => { setResult(null); setRound(round + 1); }} testID="quiz-retry" />}>
        <View style={styles.center}>
          {result.passed ? <Celebrate size={130}><Art3D name="trophy" size={120} /></Celebrate> : <Art3D name="verify_fix" size={110} float />}
          <Txt variant="title1" align="center" heading testID={result.passed ? 'quiz-passed' : 'quiz-failed'}>
            {result.passed ? t('learn.quizPassed') : t('learn.quizFailed', { n: result.correct, total: result.total, pass: result.course.quiz.passCorrect })}
          </Txt>
          {result.passed && result.course.certificate ? (
            <View style={styles.cert} testID="quiz-certificate">
              <Icon name="ribbon" size={28} color="success" />
              <View style={styles.flex}>
                <Txt variant="label" color="onSuccessTint">{t('learn.certTitle')}</Txt>
                <Txt variant="bodyStrong">{result.course.certificate.title}</Txt>
                <Txt variant="footnote" color="inkMuted">{t('learn.certBody')}</Txt>
              </View>
            </View>
          ) : null}
        </View>
      </Screen>
    );
  }

  return (
    <Screen testID="tech-course-quiz" header={<Header title={t('learn.quizTitle')} />}
      footer={<Button label={t('learn.quizSubmit')} icon="checkmark-done" disabled={!complete} loading={busy} onPress={() => void submit()} testID="quiz-submit" />}>
      <ErrorBanner error={error} />
      {!quiz ? <Skeleton style={styles.skeleton} /> : quiz.questions.map((q) => (
        <View key={q.n} style={styles.question}>
          <Txt variant="bodyStrong" lang={locale}>{q.n + 1}. {q.q[locale]}</Txt>
          {q.options.map((o) => {
            const on = answers[String(q.n)] === o.id;
            return (
              <Tap key={o.id} onPress={() => setAnswers({ ...answers, [String(q.n)]: o.id })} style={[styles.option, on && styles.optionOn]} accessibilityRole="radio" accessibilityState={{ selected: on }} haptic testID={`quiz-${q.n}-${o.id}`}>
                <View style={[styles.dot, on && styles.dotOn]}>{on ? <Icon name="checkmark" size={14} color="onNavy" /> : null}</View>
                <Txt variant="callout" style={styles.flex} lang={locale}>{o[locale]}</Txt>
              </Tap>
            );
          })}
        </View>
      ))}
      {quiz && !complete ? <Banner tone="info" icon="information-circle" text={t('learn.answerAll')} /> : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: { alignItems: 'center', gap: space.lg, paddingVertical: space.xl },
  skeleton: { height: 360, borderRadius: radius.lg },
  question: { gap: space.sm },
  option: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md, borderRadius: radius.lg, backgroundColor: colors.surface, borderWidth: 1.5, borderColor: colors.line },
  optionOn: { borderColor: colors.navy, backgroundColor: colors.blueTint },
  dot: { width: 24, height: 24, borderRadius: 12, borderWidth: 2, borderColor: colors.lineStrong, alignItems: 'center', justifyContent: 'center' },
  dotOn: { backgroundColor: colors.navy, borderColor: colors.navy },
  cert: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.lg, borderRadius: radius.lg, backgroundColor: colors.successTint, alignSelf: 'stretch' },
});
