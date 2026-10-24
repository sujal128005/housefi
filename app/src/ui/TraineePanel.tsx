// Apprentice mode on the technician's job screen: bring an apprentice (only when the customer agreed, before arriving),
// take them off, and after the job say whether they helped (yes pays them from Housefi).
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import type { Job } from '../domain/types';
import { formatRupees } from '../i18n/format';
import { useI18n } from '../i18n/I18n';
import { useBackend, useQuery } from '../services/ServicesProvider';
import { useTechSession } from '../state/AppState';
import { space } from '../theme/tokens';
import { Button } from './Button';
import { ErrorBanner } from './States';
import { Banner, Card, Pill } from './Surfaces';
import { TechPhoto } from './TechIdentity';
import { Txt } from './Txt';

const BEFORE_ARRIVAL: readonly Job['status'][] = ['ASSIGNED', 'EN_ROUTE'];

export function TraineePanel({ job: j, onChange }: { readonly job: Job; readonly onChange: (j: Job) => void }) {
  const { t } = useI18n();
  const backend = useBackend();
  const session = useTechSession();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const canBring = !!j.allowTrainee && !j.trainee && BEFORE_ARRIVAL.includes(j.status);
  const overview = useQuery(() => (canBring ? backend.tech.apprentice(session.token) : Promise.resolve(null)), [backend, session.token, canBring]);
  const mine = overview.data?.mentor.apprentices.filter((a) => a.categoryId === j.categoryId) ?? [];

  const run = async (f: () => Promise<Job>) => {
    setBusy(true);
    setError(null);
    try {
      onChange(await f());
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  if (!j.trainee && !(canBring && mine.length > 0)) return null;
  const tr = j.trainee;
  return (
    <Card style={styles.card} testID="tj-trainee">
      <Txt variant="title3" heading>{t('trainee.title')}</Txt>
      {tr ? (
        <>
          <View style={styles.row}>
            <TechPhoto photo={tr.photo} gender={tr.gender} size={48} />
            <View style={styles.flex}>
              <Txt variant="bodyStrong">{tr.name}</Txt>
              <Txt variant="caption" color="navy" lang="en">{tr.techCode}</Txt>
            </View>
            {tr.helped === true ? <Pill tone="success" icon="checkmark-circle" label={t('trainee.paid', { amount: formatRupees(overview.data?.shareRupees ?? 100) })} /> : null}
          </View>
          {BEFORE_ARRIVAL.includes(j.status) ? (
            <>
              <Txt variant="footnote" color="inkMuted">{t('trainee.comingNote')}</Txt>
              <Button label={t('trainee.takeOff')} icon="person-remove-outline" variant="outline" size="md" loading={busy}
                onPress={() => void run(() => backend.tech.removeTrainee(session.token, j.id))} testID="tj-trainee-remove" />
            </>
          ) : null}
          {(j.status === 'COMPLETED' || j.status === 'CLOSED_NO_REPAIR') && tr.helped === null ? (
            <>
              <Txt variant="bodyStrong">{t('trainee.helpedQ', { name: tr.name })}</Txt>
              <Txt variant="footnote" color="inkMuted">{t('trainee.helpedSub')}</Txt>
              <View style={styles.row}>
                <Button label={t('trainee.yes')} icon="checkmark" size="md" style={styles.flex} loading={busy}
                  onPress={() => void run(() => backend.tech.confirmTrainee(session.token, j.id, true))} testID="tj-trainee-yes" />
                <Button label={t('trainee.no')} variant="outline" size="md" style={styles.flex} disabled={busy}
                  onPress={() => void run(() => backend.tech.confirmTrainee(session.token, j.id, false))} testID="tj-trainee-no" />
              </View>
            </>
          ) : null}
        </>
      ) : (
        <>
          <Banner tone="info" icon="school-outline" text={t('trainee.customerOk')} />
          {mine.map((a) => (
            <View key={a.id} style={styles.row}>
              <TechPhoto photo={a.other.photo} gender={a.other.gender} size={44} />
              <Txt variant="bodyStrong" style={styles.flex}>{a.other.name}</Txt>
              <Button label={t('trainee.bring')} icon="person-add-outline" size="md" loading={busy}
                onPress={() => void run(() => backend.tech.addTrainee(session.token, j.id, a.other.id))} testID={`tj-trainee-bring-${a.other.id}`} />
            </View>
          ))}
        </>
      )}
      <ErrorBanner error={error} />
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: space.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  flex: { flex: 1 },
});
