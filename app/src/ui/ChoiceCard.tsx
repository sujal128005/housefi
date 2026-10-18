import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { colors, radius, shadow, space } from '../theme/tokens';
import type { Locale } from '../i18n/format';
import { Icon } from './Icon';
import { Tap } from './Tap';
import { Txt } from './Txt';

/** A large, single-choice card: art on the left, title and line, and a check when selected. */
export function ChoiceCard({ title, subtitle, art, selected, onPress, testID, titleLang }: {
  readonly title: string;
  readonly subtitle?: string;
  readonly art: ReactNode;
  readonly selected: boolean;
  readonly onPress: () => void;
  readonly testID?: string;
  readonly titleLang?: Locale;
}) {
  return (
    <Tap
      testID={testID}
      onPress={onPress}
      haptic
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={subtitle ? `${title}, ${subtitle}` : title}
      style={[styles.card, selected && styles.on]}
    >
      <View style={styles.art}>{art}</View>
      <View style={styles.text}>
        <Txt variant="title3" lang={titleLang}>{title}</Txt>
        {subtitle ? <Txt variant="footnote" color="inkMuted">{subtitle}</Txt> : null}
      </View>
      <View style={[styles.check, selected && styles.checkOn]}>
        {selected ? <Icon name="checkmark" size={18} color="onNavy" /> : null}
      </View>
    </Tap>
  );
}

const styles = StyleSheet.create({
  card: { flexDirection: 'row', alignItems: 'center', gap: space.lg, padding: space.lg, minHeight: 88, borderRadius: radius.xl, backgroundColor: colors.surface, borderWidth: 2, borderColor: colors.line, ...shadow.card },
  on: { borderColor: colors.blue, backgroundColor: '#FBFCFF' },
  art: { width: 56, height: 56, borderRadius: 18, backgroundColor: colors.blueTint, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  text: { flex: 1, gap: 2 },
  check: { width: 28, height: 28, borderRadius: 14, borderWidth: 2, borderColor: colors.lineStrong, alignItems: 'center', justifyContent: 'center' },
  checkOn: { backgroundColor: colors.blue, borderColor: colors.blue },
});
