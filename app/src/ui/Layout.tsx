import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import type { ReactNode } from 'react';
import { KeyboardAvoidingView, ScrollView, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useI18n } from '../i18n/I18n';
import { colors, space, washes, type WashName } from '../theme/tokens';
import { Icon } from './Icon';
import { MAX_CONTENT, useLayout } from './responsive';
import { DemoPill } from './Surfaces';
import { Tap } from './Tap';
import { Txt } from './Txt';

/** Pastel gradient. With `fade`, it melts into the page background at the bottom (used behind screen tops). */
export function Wash({ name, style, children, fade }: { readonly name: WashName; readonly style?: StyleProp<ViewStyle>; readonly children?: ReactNode; readonly fade?: boolean }) {
  const [a, b] = washes[name];
  if (fade) {
    return (
      <LinearGradient colors={[a, b, colors.canvas]} locations={[0, 0.55, 1]} start={{ x: 0.2, y: 0 }} end={{ x: 0.5, y: 1 }} style={style}>
        {children}
      </LinearGradient>
    );
  }
  return (
    <LinearGradient colors={[a, b]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={style}>
      {children}
    </LinearGradient>
  );
}

export function BackButton({ onPress, testID = 'back' }: { readonly onPress?: () => void; readonly testID?: string }) {
  const { t } = useI18n();
  return (
    <Tap
      testID={testID}
      onPress={onPress ?? (() => (router.canGoBack() ? router.back() : router.replace('/')))}
      style={styles.back}
      accessibilityLabel={t('common.back')}
      hitSlop={8}
    >
      <Icon name="chevron-back" size={24} color="ink" />
    </Tap>
  );
}

export interface HeaderProps {
  readonly title?: string;
  readonly back?: boolean;
  readonly onBack?: () => void;
  readonly step?: string;
  readonly right?: ReactNode;
  readonly demo?: boolean;
}

/** Top bar: back chevron, optional title and step, and the DEMO marker on the right. */
export function Header({ title, back = true, onBack, step, right, demo = true }: HeaderProps) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.header, { paddingTop: insets.top + space.sm }]}>
      <View style={[styles.headerRow, styles.column]}>
        {back ? <BackButton onPress={onBack} /> : <View style={styles.backSpace} />}
        <View style={styles.headerTitle}>
          {step ? <Txt variant="caption" color="inkMuted" align="center">{step}</Txt> : null}
          {title ? <Txt variant="title3" heading align="center" numberOfLines={1}>{title}</Txt> : null}
        </View>
        <View style={styles.headerRight}>{right ?? (demo ? <DemoPill /> : null)}</View>
      </View>
    </View>
  );
}

export interface ScreenProps {
  readonly children: ReactNode;
  readonly header?: ReactNode;
  readonly footer?: ReactNode;
  readonly wash?: WashName;
  readonly scroll?: boolean;
  readonly contentStyle?: StyleProp<ViewStyle>;
  readonly testID?: string;
}

/**
 * Standard screen: optional pastel wash behind the top, a header, scrolling content with the side gutter, and a
 * footer pinned above the home indicator (and above the keyboard).
 */
export function Screen({ children, header, footer, wash, scroll = true, contentStyle, testID }: ScreenProps) {
  const insets = useSafeAreaInsets();
  const { gutter } = useLayout();
  const body = scroll ? (
    <ScrollView
      contentContainerStyle={[styles.content, { paddingHorizontal: gutter }, !footer && { paddingBottom: insets.bottom + space.xxl }, contentStyle]}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
      {children}
    </ScrollView>
  ) : (
    <View style={[styles.flex, styles.content, { paddingHorizontal: gutter }, contentStyle]}>{children}</View>
  );
  return (
    <View testID={testID} style={styles.root}>
      {wash ? <Wash name={wash} fade style={styles.wash} /> : null}
      {/* Padding on both platforms: Android draws edge-to-edge, so the window is not resized for the keyboard. The
          view adds only the overlap, so it stays correct if a device does resize. */}
      <KeyboardAvoidingView style={styles.flex} behavior="padding">
        {header}
        {body}
        {footer ? <Footer>{footer}</Footer> : null}
      </KeyboardAvoidingView>
    </View>
  );
}

export function Footer({ children }: { readonly children: ReactNode }) {
  const insets = useSafeAreaInsets();
  const { gutter } = useLayout();
  return (
    <View style={[styles.footer, { paddingHorizontal: gutter, paddingBottom: Math.max(insets.bottom, space.lg) }]}>
      <View style={[styles.column, styles.footerInner]}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.canvas },
  flex: { flex: 1 },
  wash: { position: 'absolute', top: 0, left: 0, right: 0, height: 480 },
  // Children are centred and capped in width on tablets (see responsive.ts).
  content: { paddingTop: space.sm, gap: space.lg, width: '100%', maxWidth: MAX_CONTENT, alignSelf: 'center' },
  column: { width: '100%', maxWidth: MAX_CONTENT, alignSelf: 'center' },
  header: { paddingHorizontal: space.md, paddingBottom: space.sm },
  headerRow: { flexDirection: 'row', alignItems: 'center', minHeight: 48 },
  headerTitle: { flex: 1, alignItems: 'center', paddingHorizontal: space.sm },
  headerRight: { minWidth: 48, alignItems: 'flex-end', paddingRight: space.xs },
  back: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line },
  backSpace: { width: 48 },
  footer: { paddingTop: space.md, backgroundColor: colors.surface, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line },
  footerInner: { gap: space.sm },
});
