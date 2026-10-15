import { StyleSheet, View } from 'react-native';
import { useI18n } from '../i18n/I18n';
import { colors, GUTTER, radius } from '../theme/tokens';
import { Header } from './Layout';

export const BOOKING_STEPS = 5;

/** Header for the booking steps, with "Step n of 5" and a slim progress bar. */
export function StepHeader({ step, title }: { readonly step: number; readonly title?: string }) {
  const { t } = useI18n();
  return (
    <View>
      <Header title={title} step={t('book.step', { n: step, total: BOOKING_STEPS })} />
      <View style={styles.track} accessibilityElementsHidden>
        <View style={[styles.fill, { width: `${(step / BOOKING_STEPS) * 100}%` }]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  track: { height: 4, marginHorizontal: GUTTER, borderRadius: radius.pill, backgroundColor: colors.line, overflow: 'hidden', marginBottom: 4 },
  fill: { height: 4, borderRadius: radius.pill, backgroundColor: colors.blue },
});
