// One course: what it covers, its lessons (watched ones ticked), the way in (start a free course, or buy an advanced
// one for 99 rupees through the same checkout as bookings), the quiz once every lesson is watched, and the certificate
// once the quiz is passed.
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { categoryById } from '../../../../data/catalog';
import type { Course } from '../../../../domain/types';
import { Art3D } from '../../../../illustrations/Art3D';
import { formatDate, formatDuration } from '../../../../i18n/format';
import { useI18n, type StringKey } from '../../../../i18n/I18n';
import { feedback } from '../../../../services/feedback';
import { useBackend } from '../../../../services/ServicesProvider';
import { useTechSession } from '../../../../state/AppState';
import { colors, radius, space } from '../../../../theme/tokens';
import { Banner, Button, Card, ErrorBanner, Header, Icon, Pill, Screen, Skeleton, Tap, Txt } from '../../../../ui';
import { Celebrate } from '../../../../ui/motion';

export default function CourseScreen() {
  const { t, l, locale } = useI18n();
  const { id } = useLocalSearchParams<{ id: string }>();
  const backend = useBackend();
  const session = useTechSession();
  const [course, setCourse] = useState<Course | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [unpaid, setUnpaid] = useState(false);

  useFocusEffect(useCallback(() => {
    let alive = true;
    void backend.tech.course(session.token, id).then((c) => alive && setCourse(c)).catch((e: unknown) => alive && setError(e));
    return () => {
      alive = false;
    };
  }, [backend, session.token, id]));

  const join = async () => {
    if (!course) return;
    setBusy(true);
    setError(null);
    setUnpaid(false);
    try {
      const next = course.access === 'PAY' ? await backend.tech.buyCourse(session.token, id) : await backend.tech.enrollCourse(session.token, id);
      setCourse(next);
      if (next.enrolled) feedback('success');
      else setUnpaid(true);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  if (!course) {
    return (
      <Screen testID="tech-course" header={<Header />}>
        <ErrorBanner error={error} />
        {!error ? <Skeleton style={styles.skeleton} /> : null}
      </Screen>
    );
  }

  const cat = course.categoryId ? categoryById(course.categoryId) : null;
  const nextLesson = course.lessonList.find((x) => !x.completed) ?? course.lessonList[0];
  const openLesson = (lessonId: string) => router.push({ pathname: '/tech/course/[id]/[lessonId]', params: { id, lessonId } });

  return (
    <Screen
      testID="tech-course"
      wash={course.completed ? 'mint' : 'sky'}
      header={<Header title={t(`learn.level.${course.level}` as StringKey)} />}
      footer={!course.enrolled ? (
        <Button label={course.access === 'PAY' ? t('learn.buy', { price: course.price }) : t('learn.start')} icon={course.access === 'PAY' ? 'card' : 'play'} loading={busy} onPress={() => void join()} testID="course-join" />
      ) : !course.completed && nextLesson && !course.quiz.unlocked ? (
        <Button label={course.completedLessons === 0 ? t('learn.start') : t('learn.next')} icon="play" onPress={() => openLesson(nextLesson.id)} testID="course-continue" />
      ) : !course.completed && course.quiz.unlocked ? (
        <Button label={t('learn.quizStart')} icon="help-circle" variant="lime" onPress={() => router.push({ pathname: '/tech/course/[id]/quiz', params: { id } })} testID="course-quiz" />
      ) : undefined}
    >
      <View style={styles.hero}>
        {course.completed ? <Celebrate size={110}><Art3D name="trophy" size={100} /></Celebrate>
          : <Art3D name={course.level === 'SAFETY' ? 'shield' : cat?.art ?? 'toolbox'} size={96} float />}
        <Txt variant="caption" color="inkMuted">{cat ? l(cat.name) : t('learn.forAll')}</Txt>
        <Txt variant="title1" align="center" heading testID="course-title">{l(course.title)}</Txt>
        <Txt variant="body" color="inkMuted" align="center">{l(course.summary)}</Txt>
        <View style={styles.pills}>
          <Pill label={t('learn.lessons', { n: course.lessons, min: Math.max(1, Math.round(course.durationSec / 60)) })} />
          {course.completed ? <Pill tone="success" icon="ribbon" label={t('learn.completed')} />
            : <Pill tone={course.access === 'PAY' ? 'warning' : 'success'} label={course.access === 'PAY' ? t('learn.price', { price: course.price }) : course.access === 'RATING' ? t('learn.freeRating') : t('learn.free')} />}
        </View>
      </View>
      {unpaid ? <Banner tone="warning" icon="time-outline" text={t('learn.paymentPending')} testID="course-unpaid" /> : null}
      <ErrorBanner error={error} />

      {course.certificate ? (
        <Card style={styles.cert} testID="course-certificate">
          <Icon name="ribbon" size={28} color="success" />
          <View style={styles.flex}>
            <Txt variant="label" color="onSuccessTint">{t('learn.certTitle')}</Txt>
            <Txt variant="bodyStrong">{course.certificate.title}</Txt>
            <Txt variant="footnote" color="inkMuted">{t('learn.certOn', { date: formatDate(new Date(course.certificate.at), locale) })} · {t('learn.certBody')}</Txt>
          </View>
        </Card>
      ) : null}

      <Txt variant="title3" heading>{t('learn.lessonsTitle')}</Txt>
      {!course.enrolled ? <Txt variant="footnote" color="inkMuted">{t('learn.locked')}</Txt> : <Txt variant="footnote" color="inkMuted">{t('learn.noSkip')}</Txt>}
      {course.lessonList.map((x, i) => (
        <Tap key={x.id} onPress={() => (course.enrolled ? openLesson(x.id) : undefined)} disabled={!course.enrolled} style={styles.lesson} testID={`course-lesson-${x.id}`} accessibilityLabel={l(x.title)}>
          <View style={[styles.num, x.completed && styles.numDone]}>
            {x.completed ? <Icon name="checkmark" size={16} color="onNavy" /> : course.enrolled ? <Txt variant="label" color="navy">{i + 1}</Txt> : <Icon name="lock-closed" size={14} color="inkSubtle" />}
          </View>
          <View style={styles.flex}>
            <Txt variant="bodyStrong" color={course.enrolled ? 'ink' : 'inkMuted'}>{l(x.title)}</Txt>
            <Txt variant="footnote" color="inkMuted">{x.completed ? t('learn.watched') : x.watchedSec > 0 ? `${formatDuration(x.watchedSec)} / ${formatDuration(x.durationSec)}` : formatDuration(x.durationSec)}</Txt>
          </View>
          {course.enrolled ? <Icon name="play-circle" size={26} color="navy" /> : null}
        </Tap>
      ))}

      <Card style={styles.quiz} testID="course-quiz-card">
        <Icon name="help-circle" size={24} color={course.quiz.unlocked ? 'navy' : 'inkSubtle'} />
        <View style={styles.flex}>
          <Txt variant="bodyStrong">{t('learn.quizTitle')}</Txt>
          <Txt variant="footnote" color="inkMuted">{course.quiz.unlocked || course.completed ? t('learn.quizReady', { n: course.quiz.questions, pass: course.quiz.passCorrect }) : t('learn.quizLocked')}</Txt>
          {course.quiz.lastCorrect !== null && !course.completed ? <Txt variant="footnote" color="inkMuted">{t('learn.lastTry', { n: course.quiz.lastCorrect })}</Txt> : null}
        </View>
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  skeleton: { height: 360, borderRadius: radius.lg },
  hero: { alignItems: 'center', gap: space.sm, paddingVertical: space.md },
  pills: { flexDirection: 'row', gap: space.sm, flexWrap: 'wrap', justifyContent: 'center' },
  cert: { flexDirection: 'row', alignItems: 'center', gap: space.md, backgroundColor: colors.successTint },
  lesson: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md, borderRadius: radius.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line },
  num: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.blueTint },
  numDone: { backgroundColor: colors.success },
  quiz: { flexDirection: 'row', alignItems: 'center', gap: space.md },
});
