import { useEffect, useRef, type ReactNode } from 'react';
import { Animated, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import type { BookingStatus } from '../domain/types';
import { useI18n } from '../i18n/I18n';
import { colors, radius, shadow, space } from '../theme/tokens';
import { Icon, type IconName } from './Icon';
import { Tap } from './Tap';
import { Txt, type TextColor } from './Txt';
import { useIsDemo } from '../services/ServicesProvider';

export function Card({ children, style, onPress, testID, accessibilityLabel, selected }: {
  readonly children: ReactNode;
  readonly style?: StyleProp<ViewStyle>;
  readonly onPress?: () => void;
  readonly testID?: string;
  readonly accessibilityLabel?: string;
  readonly selected?: boolean;
}) {
  const look = [styles.card, selected && styles.cardSelected, style];
  if (!onPress) return <View testID={testID} style={look}>{children}</View>;
  return (
    <Tap testID={testID} onPress={onPress} style={look} accessibilityLabel={accessibilityLabel} accessibilityState={{ selected: !!selected }} scale={0.98}>
      {children}
    </Tap>
  );
}

export function SectionTitle({ title, action, onAction, style }: { readonly title: string; readonly action?: string; readonly onAction?: () => void; readonly style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[styles.section, style]}>
      <Txt variant="title3" heading style={styles.flex}>{title}</Txt>
      {action && onAction ? (
        <Tap onPress={onAction} style={styles.sectionAction} accessibilityLabel={action}>
          <Txt variant="label" color="blue">{action}</Txt>
        </Tap>
      ) : null}
    </View>
  );
}

/** Selectable chip (issues, labels, cancel reasons). */
export function Chip({ label, selected, onPress, icon, testID }: { readonly label: string; readonly selected: boolean; readonly onPress: () => void; readonly icon?: IconName; readonly testID?: string }) {
  return (
    <Tap
      testID={testID}
      onPress={onPress}
      haptic
      accessibilityRole="checkbox"
      accessibilityState={{ checked: selected }}
      accessibilityLabel={label}
      style={[styles.chip, selected ? styles.chipOn : styles.chipOff]}
    >
      {selected ? <Icon name="checkmark-circle" size={18} color="blue" /> : icon ? <Icon name={icon} size={18} color="inkMuted" /> : null}
      <Txt variant="callout" color={selected ? 'onBlueTint' : 'ink'} weight={selected ? 'semibold' : 'medium'}>{label}</Txt>
    </Tap>
  );
}

export function RadioDot({ on }: { readonly on: boolean }) {
  return (
    <View style={[styles.radio, on && styles.radioOn]}>
      {on ? <View style={styles.radioInner} /> : null}
    </View>
  );
}

export function ListRow({ icon, title, subtitle, onPress, right, testID, tone = 'ink', tag }: {
  readonly icon?: IconName;
  readonly title: string;
  readonly subtitle?: string;
  readonly onPress?: () => void;
  readonly right?: ReactNode;
  readonly testID?: string;
  readonly tone?: TextColor;
  readonly tag?: string;
}) {
  const body = (
    <>
      {icon ? (
        <View style={styles.rowIcon}>
          <Icon name={icon} size={20} color={tone === 'danger' ? 'danger' : 'navy'} />
        </View>
      ) : null}
      <View style={styles.flex}>
        <Txt variant="bodyStrong" color={tone}>{title}</Txt>
        {subtitle ? <Txt variant="footnote" color="inkMuted">{subtitle}</Txt> : null}
      </View>
      {tag ? <Pill tone="demo" label={tag} /> : null}
      {right ?? (onPress ? <Icon name="chevron-forward" size={18} color="inkSubtle" /> : null)}
    </>
  );
  if (!onPress) return <View style={styles.row} testID={testID}>{body}</View>;
  return <Tap testID={testID} onPress={onPress} style={styles.row} scale={0.99} accessibilityLabel={subtitle ? `${title}, ${subtitle}` : title}>{body}</Tap>;
}

export type PillTone = 'demo' | 'info' | 'success' | 'warning' | 'danger' | 'neutral';

const PILL: Record<PillTone, { bg: string; fg: TextColor }> = {
  demo: { bg: colors.demoTint, fg: 'demo' },
  info: { bg: colors.blueTint, fg: 'onBlueTint' },
  success: { bg: colors.successTint, fg: 'onSuccessTint' },
  warning: { bg: colors.warningTint, fg: 'onWarningTint' },
  danger: { bg: colors.dangerTint, fg: 'onDangerTint' },
  neutral: { bg: colors.surfaceMuted, fg: 'inkMuted' },
};

export function Pill({ label, tone = 'neutral', icon }: { readonly label: string; readonly tone?: PillTone; readonly icon?: IconName }) {
  const look = PILL[tone];
  return (
    <View style={[styles.pill, { backgroundColor: look.bg }]}>
      {icon ? <Icon name={icon} size={13} color={look.fg} /> : null}
      <Txt variant="caption" color={look.fg} numberOfLines={1}>{label}</Txt>
    </View>
  );
}

export function DemoPill() {
  const { t } = useI18n();
  if (!useIsDemo()) return null;
  return <View accessibilityLabel="Demo mode"><Pill label={t('common.demo')} tone="demo" icon="flask" /></View>;
}

const STATUS_TONE: Record<BookingStatus, PillTone> = {
  AWAITING_PAYMENT: 'warning',
  PAYMENT_PENDING: 'warning',
  MATCHING: 'info',
  MATCHING_DELAYED: 'warning',
  UNFULFILLED: 'danger',
  ASSIGNED: 'success',
  EN_ROUTE: 'info',
  ARRIVED: 'success',
  INSPECTING: 'info',
  QUOTE_SHARED: 'warning',
  IN_PROGRESS: 'info',
  EXTRA_WORK: 'warning',
  PAYMENT_DUE: 'warning',
  COMPLETED: 'success',
  CLOSED_NO_REPAIR: 'neutral',
  CANCELLED: 'neutral',
};

const STATUS_ICON: Record<BookingStatus, IconName> = {
  AWAITING_PAYMENT: 'card',
  PAYMENT_PENDING: 'hourglass',
  MATCHING: 'search',
  MATCHING_DELAYED: 'time',
  UNFULFILLED: 'alert-circle',
  ASSIGNED: 'checkmark-circle',
  EN_ROUTE: 'bicycle',
  ARRIVED: 'location',
  INSPECTING: 'eye',
  QUOTE_SHARED: 'document-text',
  IN_PROGRESS: 'construct',
  EXTRA_WORK: 'add-circle',
  PAYMENT_DUE: 'wallet',
  COMPLETED: 'checkmark-done-circle',
  CLOSED_NO_REPAIR: 'remove-circle',
  CANCELLED: 'close-circle',
};

export function StatusPill({ status }: { readonly status: BookingStatus }) {
  const { t } = useI18n();
  return <Pill label={t(`status.${status}`)} tone={STATUS_TONE[status]} icon={STATUS_ICON[status]} />;
}

export type BannerTone = 'demo' | 'info' | 'warning' | 'danger' | 'success';

const BANNER: Record<BannerTone, { bg: string; fg: TextColor; icon: IconName }> = {
  demo: { bg: colors.demoTint, fg: 'demo', icon: 'flask' },
  info: { bg: colors.blueTint, fg: 'onBlueTint', icon: 'information-circle' },
  warning: { bg: colors.warningTint, fg: 'onWarningTint', icon: 'time' },
  danger: { bg: colors.dangerTint, fg: 'onDangerTint', icon: 'alert-circle' },
  success: { bg: colors.successTint, fg: 'onSuccessTint', icon: 'checkmark-circle' },
};

export function Banner({ tone, text, icon, action, onAction, testID }: {
  readonly tone: BannerTone;
  readonly text: string;
  readonly icon?: IconName;
  readonly action?: string;
  readonly onAction?: () => void;
  readonly testID?: string;
}) {
  const look = BANNER[tone];
  return (
    <View testID={testID} style={[styles.banner, { backgroundColor: look.bg }]} accessibilityRole={tone === 'danger' ? 'alert' : undefined}>
      <Icon name={icon ?? look.icon} size={20} color={look.fg} />
      <Txt variant="footnote" color={look.fg} weight="medium" style={styles.flex}>{text}</Txt>
      {action && onAction ? (
        <Tap onPress={onAction} style={styles.bannerAction} accessibilityLabel={action}>
          <Txt variant="label" color={look.fg} weight="bold">{action}</Txt>
        </Tap>
      ) : null}
    </View>
  );
}

export function Segmented<T extends string>({ value, options, onChange }: { readonly value: T; readonly options: readonly { readonly value: T; readonly label: string }[]; readonly onChange: (v: T) => void }) {
  return (
    <View style={styles.segment} accessibilityRole="tablist">
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Tap key={o.value} onPress={() => onChange(o.value)} style={[styles.segmentItem, on && styles.segmentOn]} accessibilityRole="tab" accessibilityState={{ selected: on }} accessibilityLabel={o.label} testID={`seg-${o.value}`}>
            <Txt variant="label" color={on ? 'onNavy' : 'inkMuted'} align="center">{o.label}</Txt>
          </Tap>
        );
      })}
    </View>
  );
}

/** Pulsing grey block shown while content loads. */
export function Skeleton({ style }: { readonly style?: StyleProp<ViewStyle> }) {
  const v = useRef(new Animated.Value(0.5)).current;
  useEffect(() => {
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(v, { toValue: 1, duration: 700, useNativeDriver: true }),
      Animated.timing(v, { toValue: 0.5, duration: 700, useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [v]);
  return <Animated.View style={[styles.skeleton, { opacity: v }, style]} accessibilityLabel="Loading" />;
}

export function Divider({ style }: { readonly style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.divider, style]} />;
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: space.lg, borderWidth: 1, borderColor: colors.line, ...shadow.card },
  cardSelected: { borderColor: colors.blue, borderWidth: 2, backgroundColor: '#FBFCFF' },
  section: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  sectionAction: { minHeight: 40, justifyContent: 'center', paddingHorizontal: space.xs },
  chip: { flexDirection: 'row', alignItems: 'center', gap: space.xs, minHeight: 44, paddingHorizontal: space.md, borderRadius: radius.pill, borderWidth: 1.5 },
  chipOn: { backgroundColor: colors.blueTint, borderColor: colors.blue },
  chipOff: { backgroundColor: colors.surface, borderColor: colors.line },
  radio: { width: 24, height: 24, borderRadius: 12, borderWidth: 2, borderColor: colors.lineStrong, alignItems: 'center', justifyContent: 'center' },
  radioOn: { borderColor: colors.blue },
  radioInner: { width: 12, height: 12, borderRadius: 6, backgroundColor: colors.blue },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 60, paddingVertical: space.sm },
  rowIcon: { width: 40, height: 40, borderRadius: radius.icon, backgroundColor: colors.blueTint, alignItems: 'center', justifyContent: 'center' },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: space.sm, paddingVertical: 3, borderRadius: radius.pill, alignSelf: 'flex-start' },
  banner: { flexDirection: 'row', alignItems: 'center', gap: space.sm, padding: space.md, borderRadius: radius.md },
  bannerAction: { minHeight: 36, justifyContent: 'center', paddingHorizontal: space.xs },
  segment: { flexDirection: 'row', backgroundColor: colors.surfaceMuted, borderRadius: radius.md, padding: 4, gap: 4 },
  segmentItem: { flex: 1, minHeight: 40, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center' },
  segmentOn: { backgroundColor: colors.navy },
  skeleton: { backgroundColor: '#ECEAE2', borderRadius: radius.md },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.line },
});
