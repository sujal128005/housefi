import { LinearGradient } from 'expo-linear-gradient';
import { ActivityIndicator, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { colors, radius, shadow, space } from '../theme/tokens';
import { Icon, type IconName } from './Icon';
import { Tap } from './Tap';
import { Txt, type TextColor } from './Txt';

export type ButtonVariant = 'primary' | 'accent' | 'secondary' | 'outline' | 'ghost' | 'danger' | 'success';

/** Primary is the cobalt brand gradient with a soft glow; accent is amber (for the one key action on a cobalt surface). */
const GRADIENT: Partial<Record<ButtonVariant, readonly [string, string]>> = {
  primary: ['#2A7BFF', '#0A3CF5'],
  success: ['#22B868', '#11924F'],
};

const LOOK: Record<ButtonVariant, { bg: string; fg: TextColor; border?: string }> = {
  primary: { bg: colors.navy, fg: 'onNavy' },
  accent: { bg: colors.amber, fg: 'onAmber' },
  secondary: { bg: colors.blueTint, fg: 'onBlueTint' },
  outline: { bg: colors.surface, fg: 'navy', border: colors.line },
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
  const gradient = GRADIENT[variant];
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
        (variant === 'primary' || variant === 'accent') && !inactive && shadow.button,
        variant === 'accent' && !inactive && styles.accentShadow,
        inactive && styles.inactive,
        style,
      ]}
    >
      {gradient ? <LinearGradient colors={gradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[StyleSheet.absoluteFill, styles.fill]} /> : null}
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
  base: { borderRadius: radius.lg, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5 },
  fill: { borderRadius: radius.lg },
  accentShadow: { shadowColor: '#C98A00' },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.sm },
  label: { flexShrink: 1 },
  inactive: { opacity: 0.45 },
  tag: { backgroundColor: colors.demoTint, borderRadius: radius.pill, paddingHorizontal: space.sm, paddingVertical: 1 },
});
