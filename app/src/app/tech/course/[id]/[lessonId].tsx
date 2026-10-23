// One lesson's video. It starts where the technician stopped. The position goes to the server about every 10 seconds
// and on pause, end or leaving; the server counts only watching at normal speed, and the player moves back if dragged
// ahead of what was watched. Near the end the lesson counts as watched, and the next lesson (or the quiz) is offered.
import { router, useLocalSearchParams } from 'expo-router';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useEffect, useRef, useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import type { Course, Lesson } from '../../../../domain/types';
import { formatDuration } from '../../../../i18n/format';
import { useI18n } from '../../../../i18n/I18n';
import { feedback } from '../../../../services/feedback';
import { useBackend } from '../../../../services/ServicesProvider';
import { useTechSession } from '../../../../state/AppState';
import { colors, radius, space } from '../../../../theme/tokens';
import { Banner, Button, ErrorBanner, Header, Icon, Screen, Skeleton, Txt } from '../../../../ui';

/** How far ahead of the watched point the player may be dragged before it is moved back (seconds). */
const AHEAD_SLACK_SEC = 15;

export default function LessonScreen() {
  const { t, l } = useI18n();
  const { id, lessonId } = useLocalSearchParams<{ id: string; lessonId: string }>();
  const backend = useBackend();
  const session = useTechSession();
  const [lesson, setLesson] = useState<Lesson | null>(null);
  const [course, setCourse] = useState<Course | null>(null);
  const [watched, setWatched] = useState(0);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [warned, setWarned] = useState(false);
  // What the server has counted, and when, to keep the player from running ahead of it.
  const counted = useRef({ sec: 0, at: 0 });

  useEffect(() => {
    let alive = true;
    void Promise.all([backend.tech.lesson(session.token, id, lessonId), backend.tech.course(session.token, id)]).then(([ls, c]) => {
      if (!alive) return;
      counted.current = { sec: ls.watchedSec, at: Date.now() };
      setLesson(ls);
      setCourse(c);
      setWatched(ls.watchedSec);
      setDone(ls.completed);
    }).catch((e: unknown) => alive && setError(e));
    return () => {
      alive = false;
    };
  }, [backend, session.token, id, lessonId]);

  const player = useVideoPlayer(lesson ? { uri: lesson.url } : null, (p) => {
    p.timeUpdateEventInterval = 10;
    // Pick up where it stopped (a finished lesson starts again from the beginning).
    if (lesson && !lesson.completed && lesson.watchedSec > 5) p.currentTime = lesson.watchedSec;
    p.play();
  });

  const report = useRef<(sec: number) => void>(() => undefined);
  report.current = (sec: number) => {
    if (!lesson) return;
    void backend.tech.lessonProgress(session.token, id, lessonId, sec).then((r) => {
      counted.current = { sec: r.watchedSec, at: Date.now() };
      setWatched(r.watchedSec);
      if (r.completed && !done) {
        setDone(true);
        feedback('success');
      }
    }).catch(() => undefined);
  };

  useEffect(() => {
    if (!lesson) return undefined;
    const time = player.addListener('timeUpdate', ({ currentTime }) => {
      // Dragged ahead of what was watched: back to the watched point.
      const allowed = counted.current.sec + ((Date.now() - counted.current.at) / 1000) * 1.5 + AHEAD_SLACK_SEC;
      if (!done && currentTime > allowed) {
        player.currentTime = counted.current.sec;
        setWarned(true);
        return;
      }
      report.current(currentTime);
    });
    const playing = player.addListener('playingChange', ({ isPlaying }) => {
      if (!isPlaying) report.current(player.currentTime);
    });
    const end = player.addListener('playToEnd', () => report.current(lesson.durationSec));
    return () => {
      time.remove();
      playing.remove();
      end.remove();
      report.current(player.currentTime);
    };
  }, [lesson, player, done]);

  const index = course?.lessonList.findIndex((x) => x.id === lessonId) ?? -1;
  const next = course && index >= 0 ? course.lessonList[index + 1] : undefined;
  const progress = lesson ? Math.min(1, watched / Math.max(1, lesson.durationSec)) : 0;

  return (
    <Screen
      testID="tech-lesson"
      header={<Header title={course ? l(course.title) : ''} />}
      footer={done ? (
        next ? <Button label={t('learn.next')} trailingIcon="arrow-forward" onPress={() => router.replace({ pathname: '/tech/course/[id]/[lessonId]', params: { id, lessonId: next.id } })} testID="lesson-next" />
          : <Button label={t('learn.backToCourse')} icon="checkmark-done" variant="lime" onPress={() => router.back()} testID="lesson-back" />
      ) : undefined}
    >
      <ErrorBanner error={error} />
      <View style={styles.video}>
        {lesson ? (
          Platform.OS === 'web' && !lesson.url ? <Txt variant="callout" color="onNavy">{t('learn.playerWeb')}</Txt>
            : <VideoView player={player} style={StyleSheet.absoluteFill} nativeControls contentFit="contain" testID="lesson-video" />
        ) : <Skeleton style={StyleSheet.absoluteFill} />}
      </View>
      {lesson ? (
        <>
          <Txt variant="title2" heading testID="lesson-title">{l(lesson.title)}</Txt>
          <View style={styles.row}>
            <View style={styles.track}><View style={[styles.fill, { width: `${progress * 100}%` }, done && styles.fillDone]} /></View>
            <Txt variant="footnote" color="inkMuted">{formatDuration(Math.min(watched, lesson.durationSec))} / {formatDuration(lesson.durationSec)}</Txt>
          </View>
          {done ? (
            <View style={styles.row} testID="lesson-done"><Icon name="checkmark-circle" size={20} color="success" /><Txt variant="bodyStrong" color="success">{t('learn.lessonDone')}</Txt></View>
          ) : (
            <Txt variant="footnote" color="inkMuted">{t('learn.noSkip')}</Txt>
          )}
          {warned && !done ? <Banner tone="warning" icon="play-skip-forward" text={t('learn.noSkip')} testID="lesson-no-skip" /> : null}
        </>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  video: { aspectRatio: 16 / 9, borderRadius: radius.lg, overflow: 'hidden', backgroundColor: '#0B1240', alignItems: 'center', justifyContent: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  track: { flex: 1, height: 6, borderRadius: 3, backgroundColor: colors.line, overflow: 'hidden' },
  fill: { height: 6, backgroundColor: colors.cyan },
  fillDone: { backgroundColor: colors.success },
});
