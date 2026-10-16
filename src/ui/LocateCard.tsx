import { router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { Art3D } from '../illustrations/Art3D';
import { useI18n } from '../i18n/I18n';
import { locate } from '../services/device';
import { colors, radius, space } from '../theme/tokens';
import { Icon } from './Icon';
import { useToast } from './Overlays';
import { Tap } from './Tap';
import { Txt } from './Txt';

/** "Use my current location": reads the phone's position and opens the address form pre-filled. */
export function LocateCard({ select }: { readonly select?: boolean }) {
  const { t } = useI18n();
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  const go = async () => {
    setBusy(true);
    const r = await locate();
    setBusy(false);
    if (!r.ok) {
      toast.show(t(r.reason === 'DENIED' ? 'address.locDenied' : r.reason === 'OFF' ? 'address.locOff' : 'address.locFailed'), 'location');
      return;
    }
    const { lat, lng, street, city, pincode } = r.place;
    router.push({ pathname: '/address/edit', params: { lat: String(lat), lng: String(lng), street, city, pincode, ...(select ? { select: '1' } : {}) } });
  };

  return (
    <Tap onPress={() => void go()} disabled={busy} style={styles.card} accessibilityLabel={t('address.useLocation')} testID="address-locate" haptic>
      <Art3D name="world_map" size={52} />
      <View style={styles.flex}>
        <Txt variant="bodyStrong" color="onBlueTint">{t('address.useLocation')}</Txt>
        <Txt variant="footnote" color="inkMuted">{t('address.useLocationSub')}</Txt>
      </View>
      {busy ? <ActivityIndicator color={colors.blue} /> : <Icon name="locate" size={22} color="blue" />}
    </Tap>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, gap: 2 },
  card: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 76, paddingHorizontal: space.md, borderRadius: radius.lg, backgroundColor: colors.blueTint, borderWidth: 1.5, borderColor: '#C9D8FF' },
});
