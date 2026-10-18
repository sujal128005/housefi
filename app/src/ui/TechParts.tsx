// Building blocks of the technician app: the job stage stepper, job cards, directions, and money rows.
import { Linking, Platform, StyleSheet, View } from 'react-native';
import { categoryById, serviceById } from '../data/catalog';
import type { Address, BookingStatus, Job } from '../domain/types';
import { Art3D, serviceArt } from '../illustrations/Art3D';
import { formatRupees } from '../i18n/format';
import { useI18n, type StringKey } from '../i18n/I18n';
import { colors, radius, shadow, space } from '../theme/tokens';
import { Icon } from './Icon';
import { visitTimeText } from './present';
import { Pill, StatusPill } from './Surfaces';
import { Tap } from './Tap';
import { Txt } from './Txt';

export const TECH_STEPS: readonly StringKey[] = ['tj.step.accept', 'tj.step.go', 'tj.step.start', 'tj.step.quote', 'tj.step.repair', 'tj.step.done'];

/** Which of the six steps a job is on (6 = all done, -1 = ended early). */
export function techStepIndex(status: BookingStatus): number {
  switch (status) {
    case 'ASSIGNED':
    case 'EN_ROUTE': return 1;
    case 'ARRIVED': return 2;
    case 'INSPECTING':
    case 'QUOTE_SHARED': return 3;
    case 'IN_PROGRESS':
    case 'EXTRA_WORK': return 4;
    case 'PAYMENT_DUE': return 5;
    case 'COMPLETED': return 6;
    default: return -1;
  }
}

export function TechStepper({ status }: { readonly status: BookingStatus }) {
  const { t } = useI18n();
  const at = techStepIndex(status);
  return (
    <View style={styles.stepper} accessibilityRole="progressbar" accessibilityLabel={at >= 0 ? t(TECH_STEPS[Math.min(at, 5)] ?? 'tj.step.done') : ''} testID="tech-stepper">
      {TECH_STEPS.map((k, i) => {
        const done = at > i;
        const current = at === i;
        return (
          <View key={k} style={styles.stepCol}>
            <View style={[styles.bar, done && styles.barDone, current && styles.barCurrent]} />
            <Txt variant="caption" color={current ? 'navy' : done ? 'inkMuted' : 'inkSubtle'} weight={current ? 'bold' : 'medium'} numberOfLines={1} align="center">{t(k)}</Txt>
          </View>
        );
      })}
    </View>
  );
}

/** Opens turn-by-turn directions to the customer in the phone's maps app. */
export async function openDirections(a: Address): Promise<boolean> {
  const dest = a.lat !== undefined && a.lng !== undefined ? `${a.lat},${a.lng}` : `${a.house}, ${a.street}, ${a.city} ${a.pincode}`;
  const url = Platform.OS === 'ios'
    ? `https://maps.apple.com/?daddr=${encodeURIComponent(dest)}`
    : `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(dest)}`;
  try {
    await Linking.openURL(url);
    return true;
  } catch {
    return false;
  }
}

/** A job in a list: service, customer area, time, status and what it earns. */
export function JobCard({ job, onPress }: { readonly job: Job; readonly onPress: () => void }) {
  const { t, l, locale } = useI18n();
  const svc = serviceById(job.serviceId);
  const cat = categoryById(job.categoryId);
  return (
    <Tap onPress={onPress} style={styles.card} accessibilityLabel={`${svc ? l(svc.name) : ''}, ${job.code}`} testID={`job-${job.code}`} scale={0.98}>
      <View style={styles.cardArt}>{cat ? <Art3D name={serviceArt(job.serviceId, cat.art)} size={46} /> : null}</View>
      <View style={styles.flex}>
        <Txt variant="bodyStrong" numberOfLines={1}>{svc ? l(svc.name) : job.serviceId}</Txt>
        <Txt variant="footnote" color="inkMuted" numberOfLines={1}>{job.customerName} · {job.address.street}</Txt>
        <View style={styles.cardMeta}>
          <StatusPill status={job.status} />
          {job.practice ? <Pill label={t('tech.practice')} tone="demo" icon="school" /> : null}
        </View>
        <Txt variant="caption" color="inkMuted">{visitTimeText(job.time, locale, t)} · {job.code}</Txt>
      </View>
      <View style={styles.earn}>
        <Txt variant="caption" color="inkMuted">{t('tech.earning')}</Txt>
        <Txt variant="title3" color="success">{formatRupees(job.earning)}</Txt>
      </View>
    </Tap>
  );
}

export function MoneyRow({ label, value, strong, tone }: { readonly label: string; readonly value: number; readonly strong?: boolean; readonly tone?: 'success' | 'ink' }) {
  return (
    <View style={styles.money}>
      <Txt variant={strong ? 'bodyStrong' : 'callout'} style={styles.flex}>{label}</Txt>
      <Txt variant={strong ? 'title3' : 'label'} color={tone ?? 'ink'}>{formatRupees(value)}</Txt>
    </View>
  );
}

export function InfoRow({ icon, label, value }: { readonly icon: Parameters<typeof Icon>[0]['name']; readonly label: string; readonly value: string }) {
  return (
    <View style={styles.info}>
      <View style={styles.infoIcon}><Icon name={icon} size={18} color="navy" /></View>
      <View style={styles.flex}>
        <Txt variant="caption" color="inkMuted">{label}</Txt>
        <Txt variant="callout" selectable>{value}</Txt>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  stepper: { flexDirection: 'row', gap: 4 },
  stepCol: { flex: 1, gap: 4 },
  bar: { height: 6, borderRadius: 3, backgroundColor: colors.line },
  barDone: { backgroundColor: colors.success },
  barCurrent: { backgroundColor: colors.blue },
  card: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md, borderRadius: radius.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, ...shadow.card },
  cardArt: { width: 60, height: 60, borderRadius: 18, backgroundColor: colors.blueTint, alignItems: 'center', justifyContent: 'center' },
  cardMeta: { flexDirection: 'row', gap: space.xs, flexWrap: 'wrap', marginVertical: 2 },
  earn: { alignItems: 'flex-end', gap: 2 },
  money: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  info: { flexDirection: 'row', alignItems: 'flex-start', gap: space.md },
  infoIcon: { width: 40, height: 40, borderRadius: radius.icon, backgroundColor: colors.blueTint, alignItems: 'center', justifyContent: 'center' },
});
