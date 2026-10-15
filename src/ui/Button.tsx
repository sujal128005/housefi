import { ActivityIndicator, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { colors, radius, shadow, space } from '../theme/tokens';
import { Icon, type IconName } from './Icon';
import { Tap } from './Tap';
import { Txt, type TextColor } from './Txt';

export type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger' | 'success';

const LOOK: Record<ButtonVariant, { bg: string; fg: TextColor; border?: string }> = {
  primary: { bg: colors.navy, fg: 'onNavy' },
  secondary: { bg: colors.blueTint, fg: 'onBlueTint' },
  outline: { bg: colors.surface, fg: 'navy', border: colors.lineStrong },
  ghost: { bg: 'transparent', fg: 'blue' },
  danger: { bg: colors.dangerTint, fg: 'onDangerTint' },
  success: { bg: colors.success, fg: 'onNavy' },
};

export interface ButtonProps {
  readonly label: string;
  readonly onPress: () => void;
  readonly variant?: ButtonVariant;
  readonly size?: 'lg' | 'md' | 'sm';
  readonly icon?: IconName;
  readonly trailingIcon?: IconName;
  readonly loading?: boolean;
  readonly disabled?: boolean;
  readonly testID?: string;
  readonly style?: StyleProp<ViewStyle>;
  readonly accessibilityHint?: string;
  /** Small "DEMO" / "Soon" tag inside the button. */
  readonly tag?: string;
}

export function Button({ label, onPress, variant = 'primary', size = 'lg', icon, trailingIcon, loading, disabled, testID, style, accessibilityHint, tag }: ButtonProps) {
  const look = LOOK[variant];
  const inactive = disabled || loading;
  const height = size === 'lg' ? 56 : size === 'md' ? 48 : 40;
  return (
    <Tap
      testID={testID}
      onPress={onPress}
      disabled={inactive}
      haptic
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: !!inactive, busy: !!loading }}
      style={[
        styles.base,
        { minHeight: height, backgroundColor: look.bg, borderColor: look.border ?? 'transparent', paddingHorizontal: size === 'sm' ? space.md : space.xl },
        variant === 'primary' && !inactive && shadow.button,
        inactive && styles.inactive,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={colors[look.fg]} />
      ) : (
        <View style={styles.row}>
          {icon ? <Icon name={icon} size={size === 'sm' ? 16 : 20} color={look.fg} /> : null}
          <Txt variant={size === 'lg' ? 'bodyStrong' : 'label'} color={look.fg} weight="bold" numberOfLines={2} align="center" style={styles.label}>
            {label}
          </Txt>
          {tag ? (
            <View style={styles.tag}>
              <Txt variant="caption" color="demo">{tag}</Txt>
            </View>
          ) : null}
          {trailingIcon ? <Icon name={trailingIcon} size={size === 'sm' ? 16 : 20} color={look.fg} /> : null}
        </View>
      )}
    </Tap>
  );
}

const styles = StyleSheet.create({
  base: { borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.sm },
  label: { flexShrink: 1 },
  inactive: { opacity: 0.45 },
  tag: { backgroundColor: colors.demoTint, borderRadius: radius.pill, paddingHorizontal: space.sm, paddingVertical: 1 },
});
