import { StyleSheet, View } from 'react-native';
import { categoryById, serviceById } from '../data/catalog';
import { progressIndex, PROGRESS_STEPS } from '../domain/rules';
import type { Booking } from '../domain/types';
import { useI18n } from '../i18n/I18n';
import { colors, radius, space } from '../theme/tokens';
import { CategoryBadge } from './CategoryTile';
import { Icon } from './Icon';
import { visitTimeText } from './present';
import { Card, StatusPill } from './Surfaces';
import { Txt } from './Txt';

export function BookingCard({ booking, onPress, showProgress }: { readonly booking: Booking; readonly onPress: () => void; readonly showProgress?: boolean }) {
  const { t, l, locale } = useI18n();
  const svc = serviceById(booking.serviceId);
  const cat = categoryById(booking.categoryId);
  const step = progressIndex(booking.status);
  return (
    <Card onPress={onPress} testID={`booking-${booking.code}`} accessibilityLabel={`${svc ? l(svc.name) : ''}, ${t(`status.${booking.status}`)}`}>
      <View style={styles.row}>
        {cat ? <CategoryBadge category={cat} serviceId={booking.serviceId} size={56} /> : null}
        <View style={styles.flex}>
          <StatusPill status={booking.status} />
          <Txt variant="bodyStrong" numberOfLines={1} style={styles.title}>{svc ? l(svc.name) : booking.serviceId}</Txt>
          <Txt variant="footnote" color="inkMuted" numberOfLines={1}>{visitTimeText(booking.time, locale, t)}</Txt>
          <Txt variant="caption" color="inkSubtle">{booking.code}</Txt>
        </View>
        <Icon name="chevron-forward" size={20} color="inkSubtle" />
      </View>
      {showProgress ? (
        <View style={styles.progress} accessibilityElementsHidden>
          {PROGRESS_STEPS.map((s, i) => <View key={s} style={[styles.seg, i <= step && styles.segOn]} />)}
        </View>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  flex: { flex: 1, gap: 2 },
  title: { marginTop: space.xs },
  progress: { flexDirection: 'row', gap: 4, marginTop: space.md },
  seg: { flex: 1, height: 5, borderRadius: radius.pill, backgroundColor: colors.line },
  segOn: { backgroundColor: colors.blue },
});
