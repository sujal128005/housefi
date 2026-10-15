import { StyleSheet, View } from 'react-native';
import type { Address, AddressLabel } from '../domain/types';
import { useI18n } from '../i18n/I18n';
import { colors, radius, space } from '../theme/tokens';
import { Icon, type IconName } from './Icon';
import { addressLine } from './present';
import { Card, RadioDot } from './Surfaces';
import { Tap } from './Tap';
import { Txt } from './Txt';

export const LABEL_ICON: Record<AddressLabel, IconName> = { HOME: 'home', WORK: 'briefcase', OTHER: 'location' };

export function AddressCard({ address, selected, onPress, onEdit }: {
  readonly address: Address;
  readonly selected?: boolean;
  readonly onPress?: () => void;
  readonly onEdit: () => void;
}) {
  const { t } = useI18n();
  const label = t(`address.label.${address.label}`);
  // The card body (select) and the Edit link are sibling buttons, never one button inside another.
  return (
    <Card selected={selected} style={styles.card}>
      <Tap onPress={onPress ?? onEdit} style={styles.row} scale={0.99} testID={`address-${address.label}-${address.pincode}`}
        accessibilityRole={onPress ? 'radio' : 'button'} accessibilityState={{ selected: !!selected }} accessibilityLabel={`${label}, ${addressLine(address)}`}>
        <View style={[styles.icon, selected && styles.iconOn]}>
          <Icon name={LABEL_ICON[address.label]} size={20} color={selected ? 'onNavy' : 'navy'} />
        </View>
        <View style={styles.flex}>
          <Txt variant="bodyStrong">{label}</Txt>
          <Txt variant="footnote" color="inkMuted">{addressLine(address)}</Txt>
          <Txt variant="footnote" color="inkMuted">{address.city} {address.pincode}</Txt>
        </View>
        {onPress ? <RadioDot on={!!selected} /> : null}
      </Tap>
      <Tap onPress={onEdit} style={styles.edit} accessibilityLabel={`${t('common.edit')} ${label}`} testID={`address-edit-${address.label}`}>
        <Icon name="create-outline" size={16} color="blue" />
        <Txt variant="label" color="blue">{t('common.edit')}</Txt>
      </Tap>
    </Card>
  );
}

export function AddAddressCard({ onPress, label }: { readonly onPress: () => void; readonly label: string }) {
  return (
    <Tap onPress={onPress} style={styles.add} accessibilityLabel={label} testID="address-add" haptic>
      <View style={styles.plus}><Icon name="add" size={22} color="blue" /></View>
      <Txt variant="bodyStrong" color="blue">{label}</Txt>
    </Tap>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, gap: 2 },
  card: { paddingBottom: space.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  icon: { width: 44, height: 44, borderRadius: 14, backgroundColor: colors.blueTint, alignItems: 'center', justifyContent: 'center' },
  iconOn: { backgroundColor: colors.blue },
  edit: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start', minHeight: 36, marginTop: space.xs, marginLeft: 44 + space.md },
  add: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 64, paddingHorizontal: space.lg, borderRadius: radius.lg, borderWidth: 2, borderStyle: 'dashed', borderColor: colors.blue, backgroundColor: colors.blueTint },
  plus: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
});
