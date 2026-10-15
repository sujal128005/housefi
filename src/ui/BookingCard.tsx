import { StyleSheet, View } from 'react-native';
import { categoryById, serviceById } from '../data/catalog';
import type { Booking } from '../domain/types';
import { useI18n } from '../i18n/I18n';
import { space } from '../theme/tokens';
import { CategoryBadge } from './CategoryTile';
import { Icon } from './Icon';
import { whenText } from './present';
import { Card, StatusPill } from './Surfaces';
import { Txt } from './Txt';

export function BookingCard({ booking, onPress }: { readonly booking: Booking; readonly onPress: () => void }) {
  const { t, l, locale } = useI18n();
  const svc = serviceById(booking.serviceId);
  const cat = categoryById(booking.categoryId);
  return (
    <Card onPress={onPress} testID={`booking-${booking.code}`} accessibilityLabel={`${svc ? l(svc.name) : ''}, ${t(`status.${booking.status}`)}`}>
      <View style={styles.row}>
        {cat ? <CategoryBadge category={cat} size={52} /> : null}
        <View style={styles.flex}>
          <StatusPill status={booking.status} />
          <Txt variant="bodyStrong" numberOfLines={1} style={styles.title}>{svc ? l(svc.name) : booking.serviceId}</Txt>
          <Txt variant="footnote" color="inkMuted" numberOfLines={1}>{whenText(booking.window, locale, t)}</Txt>
          <Txt variant="caption" color="inkSubtle">{booking.code}</Txt>
        </View>
        <Icon name="chevron-forward" size={20} color="inkSubtle" />
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  flex: { flex: 1, gap: 2 },
  title: { marginTop: space.xs },
});
