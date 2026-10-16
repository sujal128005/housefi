// Technician jobs: active and past, newest first.
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { isActive } from '../../../domain/rules';
import type { Job } from '../../../domain/types';
import { Art3D } from '../../../illustrations/Art3D';
import { useI18n } from '../../../i18n/I18n';
import { useBackend } from '../../../services/ServicesProvider';
import { useTechSession } from '../../../state/AppState';
import { GUTTER, space } from '../../../theme/tokens';
import { DemoPill, EmptyState, ErrorView, Screen, Segmented, Skeleton, Txt } from '../../../ui';
import { JobCard } from '../../../ui/TechParts';

export default function TechJobs() {
  const { t } = useI18n();
  const backend = useBackend();
  const session = useTechSession();
  const insets = useSafeAreaInsets();
  const [tab, setTab] = useState<'ACTIVE' | 'PAST'>('ACTIVE');
  const [jobs, setJobs] = useState<readonly Job[] | null>(null);
  const [error, setError] = useState<unknown>(null);

  useFocusEffect(useCallback(() => {
    let alive = true;
    const load = () => backend.tech.jobs(session.token).then((j) => {
      if (!alive) return;
      setJobs(j);
      setError(null);
    }, (e: unknown) => {
      if (alive) setError(e);
    });
    void load();
    const timer = setInterval(() => void load(), 4000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [backend, session.token]));

  const list = (jobs ?? []).filter((j) => (tab === 'ACTIVE' ? isActive(j.status) : !isActive(j.status)));

  return (
    <Screen
      testID="tech-jobs"
      header={
        <View style={[styles.header, { paddingTop: insets.top + space.md }]}>
          <Txt variant="title1" heading style={styles.flex}>{t('ttab.jobs')}</Txt>
          <DemoPill />
        </View>
      }
    >
      <Segmented value={tab} onChange={setTab} options={[{ value: 'ACTIVE', label: t('bookings.active') }, { value: 'PAST', label: t('bookings.past') }]} />
      {error && !jobs ? <ErrorView error={error} onRetry={() => {
        setError(null);
        backend.tech.jobs(session.token).then(setJobs, setError);
      }} /> : null}
      {!jobs && !error ? <><Skeleton style={styles.skel} /><Skeleton style={styles.skel} /></> : null}
      {jobs && list.length === 0 ? (
        <EmptyState art={<Art3D name={tab === 'ACTIVE' ? 'toolbox' : 'package'} size={110} float shadow />}
          title={tab === 'ACTIVE' ? t('tjobs.emptyActive') : t('tjobs.emptyPast')} body={tab === 'ACTIVE' ? t('tjobs.emptyActiveBody') : undefined}
          action={tab === 'ACTIVE' ? t('tjobs.goHome') : undefined} onAction={() => router.push('/tech/home')} testID="tech-jobs-empty" />
      ) : null}
      {list.map((j) => <JobCard key={j.id} job={j} onPress={() => router.push(`/tech/job/${j.id}`)} />)}
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: GUTTER, paddingBottom: space.sm },
  skel: { height: 110, borderRadius: 16 },
});
