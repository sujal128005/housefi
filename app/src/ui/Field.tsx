import { forwardRef, useState } from 'react';
import { StyleSheet, TextInput, View, type TextInputProps, type TextInputInstance } from 'react-native';
import { useI18n } from '../i18n/I18n';
import { fontFamily } from '../theme/fonts';
import { colors, radius, space } from '../theme/tokens';
import { Icon } from './Icon';
import { Txt } from './Txt';

export interface FieldProps extends Omit<TextInputProps, 'style'> {
  readonly label: string;
  readonly error?: string | null;
  readonly hint?: string;
  readonly optional?: boolean;
  /** Fixed text before the input, e.g. "+91". */
  readonly prefix?: string;
  readonly large?: boolean;
}

export const Field = forwardRef<TextInputInstance, FieldProps>(function Field({ label, error, hint, optional, prefix, large, onFocus, onBlur, ...input }, ref) {
  const { locale, t } = useI18n();
  const [focused, setFocused] = useState(false);
  const border = error ? colors.danger : focused ? colors.blue : colors.line;
  return (
    <View style={styles.wrap}>
      <View style={styles.labelRow}>
        <Txt variant="label" color="ink">{label}</Txt>
        {optional ? <Txt variant="footnote" color="inkSubtle">· {t('common.optional')}</Txt> : null}
      </View>
      <View style={[styles.box, { borderColor: border, minHeight: large ? 60 : 52 }, focused && styles.focused]}>
        {prefix ? (
          <View style={styles.prefix}>
            <Txt variant={large ? 'title3' : 'bodyStrong'} color="ink">{prefix}</Txt>
            <View style={styles.prefixRule} />
          </View>
        ) : null}
        <TextInput
          ref={ref}
          accessibilityLabel={label}
          placeholderTextColor={colors.inkSubtle}
          maxFontSizeMultiplier={1.5}
          style={[styles.input, input.multiline && styles.multiline, { fontFamily: fontFamily(large ? 'bold' : 'medium', locale), fontSize: large ? 20 : 16, letterSpacing: large && locale === 'en' ? 0.5 : 0 }]}
          onFocus={(e) => {
            setFocused(true);
            onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            onBlur?.(e);
          }}
          {...input}
        />
      </View>
      {error ? (
        <View style={styles.msg} accessibilityLiveRegion="polite">
          <Icon name="alert-circle" size={16} color="danger" />
          <Txt variant="footnote" color="danger" style={styles.flex}>{error}</Txt>
        </View>
      ) : hint ? (
        <Txt variant="footnote" color="inkMuted" style={styles.hint}>{hint}</Txt>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  wrap: { gap: space.xs },
  labelRow: { flexDirection: 'row', gap: space.xs, alignItems: 'center' },
  box: { flexDirection: 'row', alignItems: 'center', borderWidth: 1.5, borderRadius: radius.md, backgroundColor: colors.surface, paddingHorizontal: space.md },
  focused: { backgroundColor: '#FBFCFF' },
  prefix: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginRight: space.sm },
  prefixRule: { width: 1, height: 24, backgroundColor: colors.line },
  input: { flex: 1, color: colors.ink, paddingVertical: space.sm },
  multiline: { minHeight: 88, paddingTop: space.md },
  msg: { flexDirection: 'row', gap: space.xs, alignItems: 'flex-start', marginTop: 2 },
  hint: { marginTop: 2 },
  flex: { flex: 1 },
});
