// The Fair-pay meter: where the customer's money goes (technician, parts, Housefi), as the server worked it out with
// the same rules as the technician's earnings. The customer and the technician see the same numbers.
import { StyleSheet, View } from 'react-native';
import type { FairPay } from '../domain/types';
import { formatRupees } from '../i18n/format';
import { useI18n } from '../i18n/I18n';
import { colors, radius, space } from '../theme/tokens';
import { Icon } from './Icon';
import { Card } from './Surfaces';
import { Txt } from './Txt';

const TONES = { technician: colors.success, parts: colors.cyan, housefi: colors.navy } as const;

export function FairPayMeter({ split: f, viewer }: { readonly split: FairPay | null | undefined; readonly viewer: 'customer' | 'technician' }) {
  const { t } = useI18n();
  if (!f || f.total <= 0) return null;
  const housefi = Math.max(0, f.housefi);
  const parts: { key: keyof typeof TONES; amount: number; label: string; note: string }[] = [
    {
      key: 'technician', amount: f.technician, label: viewer === 'technician' ? t('fair.you') : t('fair.technician'),
      note: f.withBill ? t('fair.technicianNote', { percent: f.labourSharePercent }) : t('fair.technicianVisit'),
    },
    ...(f.parts > 0 ? [{ key: 'parts' as const, amount: f.parts, label: t('fair.parts'), note: viewer === 'technician' ? t('fair.partsNoteYou') : t('fair.partsNote') }] : []),
    { key: 'housefi', amount: housefi, label: t('fair.housefi'), note: t('fair.housefiNote') },
  ];
  const sum = parts.reduce((s, p) => s + p.amount, 0) || 1;
  return (
    <Card style={styles.card} testID="fair-pay">
      <View style={styles.head}>
        <Icon name="pie-chart" size={20} color="navy" />
        <Txt variant="title3" heading style={styles.flex}>
          {viewer === 'customer' ? t('fair.title', { amount: formatRupees(f.total) }) : t('fair.titleTech', { amount: formatRupees(f.total) })}
        </Txt>
      </View>
      <View style={styles.bar} accessible accessibilityLabel={parts.map((p) => `${p.label} ${formatRupees(p.amount)}`).join(', ')}>
        {parts.filter((p) => p.amount > 0).map((p) => <View key={p.key} style={[styles.seg, { flex: p.amount / sum, backgroundColor: TONES[p.key] }]} />)}
      </View>
      {parts.map((p) => (
        <View key={p.key} style={styles.row} testID={`fair-${p.key}`}>
          <View style={[styles.dot, { backgroundColor: TONES[p.key] }]} />
          <View style={styles.flex}>
            <Txt variant="bodyStrong">{p.label}</Txt>
            <Txt variant="footnote" color="inkMuted">{p.note}</Txt>
          </View>
          <Txt variant="bodyStrong">{formatRupees(p.amount)}</Txt>
        </View>
      ))}
      {f.coupon > 0 ? <Txt variant="footnote" color="success" testID="fair-coupon">{t('fair.coupon', { amount: formatRupees(f.coupon) })}</Txt> : null}
      {f.housefi < 0 ? <Txt variant="footnote" color="inkMuted">{t('fair.housefiAdded', { amount: formatRupees(-f.housefi) })}</Txt> : null}
      <Txt variant="caption" color="inkMuted">{t('fair.noTax')}</Txt>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: space.md },
  head: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  flex: { flex: 1 },
  bar: { flexDirection: 'row', height: 14, borderRadius: radius.pill, overflow: 'hidden', backgroundColor: colors.surfaceMuted, gap: 2 },
  seg: { height: '100%' },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  dot: { width: 12, height: 12, borderRadius: 6 },
});
