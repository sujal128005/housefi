// A dropdown for long lists (states, districts, localities): looks like a field; tapping it opens a sheet with a search
// box at the top, so "Hi" narrows India's states to Delhi and Himachal Pradesh and "Him" to Himachal alone. One choice,
// or several (with a Done button and the choices shown as removable chips under the field). `onAdd` offers to add what
// was typed when it is not in the list.
import { useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, TextInput, useWindowDimensions, View } from 'react-native';
import { filterByText } from '../domain/search';
import { useI18n } from '../i18n/I18n';
import { fontFamily } from '../theme/fonts';
import { colors, radius, space } from '../theme/tokens';
import { Button } from './Button';
import { Icon } from './Icon';
import { Sheet } from './Overlays';
import { RadioDot } from './Surfaces';
import { Tap } from './Tap';
import { Txt } from './Txt';

export interface PickerOption {
  readonly value: string;
  /** A second line, e.g. a locality's PIN codes. */
  readonly detail?: string;
}

interface Common {
  readonly label: string;
  readonly placeholder: string;
  readonly options: readonly PickerOption[];
  readonly loading?: boolean;
  /** Greyed out with this reason (e.g. "Choose a state first"). */
  readonly disabledHint?: string | null;
  readonly error?: string | null;
  readonly hint?: string;
  /** Offers "Add “…”" for typed text that is not in the list. */
  readonly onAdd?: (text: string) => void;
  /** The list could not be loaded: the sheet says so and offers to try again (instead of "nothing matches"). */
  readonly loadFailed?: boolean;
  readonly onRetry?: () => void;
  readonly testID: string;
}

type Props = Common & (
  | { readonly multiple?: false; readonly value: string | null; readonly onChange: (value: string) => void }
  | { readonly multiple: true; readonly value: readonly string[]; readonly onChange: (value: readonly string[]) => void; readonly max: number }
);

export function SearchPicker(props: Props) {
  const { t, locale } = useI18n();
  const { height } = useWindowDimensions();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const chosen: readonly string[] = props.multiple ? props.value : props.value ? [props.value] : [];
  const shown = useMemo(() => filterByText(props.options, text, (o) => o.value), [props.options, text]);
  const typed = text.trim().replace(/\s+/g, ' ');
  const canAdd = !!props.onAdd && typed.length >= 2 && !props.options.some((o) => o.value.toLowerCase() === typed.toLowerCase());
  const disabled = !!props.disabledHint;
  const full = props.multiple ? chosen.length >= props.max : false;

  const close = () => {
    setOpen(false);
    setText('');
  };
  const pick = (value: string) => {
    if (!props.multiple) {
      props.onChange(value);
      close();
      return;
    }
    const on = chosen.includes(value);
    if (!on && full) return;
    props.onChange(on ? chosen.filter((v) => v !== value) : [...chosen, value]);
  };
  const add = () => {
    props.onAdd?.(typed);
    setText('');
    if (!props.multiple) close();
  };

  const border = props.error ? colors.danger : colors.line;
  const summary = props.multiple
    ? (chosen.length > 0 ? t('picker.chosen', { n: chosen.length }) : null)
    : chosen[0] ?? null;

  return (
    <View style={styles.wrap}>
      <Txt variant="label">{props.label}</Txt>
      <Tap onPress={() => setOpen(true)} disabled={disabled} style={[styles.box, { borderColor: border }, disabled && styles.boxOff]}
        accessibilityRole="button" accessibilityLabel={`${props.label}: ${summary ?? props.placeholder}`} testID={props.testID}>
        <Txt variant={summary ? 'bodyStrong' : 'body'} color={summary ? 'ink' : 'inkSubtle'} numberOfLines={1} style={styles.flex}>
          {disabled ? props.disabledHint : summary ?? props.placeholder}
        </Txt>
        {props.loading ? <ActivityIndicator color={colors.blue} /> : <Icon name="chevron-down" size={20} color={disabled ? 'inkSubtle' : 'inkMuted'} />}
      </Tap>
      {props.multiple && chosen.length > 0 ? (
        <View style={styles.chips}>
          {chosen.map((v) => (
            <Tap key={v} onPress={() => pick(v)} style={styles.chip} accessibilityLabel={t('picker.remove', { name: v })} testID={`${props.testID}-chip-${v}`}>
              <Txt variant="label" color="onBlueTint" numberOfLines={1} style={styles.chipText}>{v}</Txt>
              <Icon name="close" size={14} color="onBlueTint" />
            </Tap>
          ))}
        </View>
      ) : null}
      {props.error ? (
        <View style={styles.msg}><Icon name="alert-circle" size={16} color="danger" /><Txt variant="footnote" color="danger" style={styles.flex}>{props.error}</Txt></View>
      ) : props.hint ? <Txt variant="footnote" color="inkMuted">{props.hint}</Txt> : null}

      <Sheet visible={open} onClose={close} testID={`${props.testID}-sheet`}>
        <View style={[styles.sheetBody, { height: Math.min(560, height * 0.72) }]}>
          <View style={styles.sheetHead}>
            <Txt variant="title3" heading style={styles.flex}>{props.label}</Txt>
            {props.multiple ? <Txt variant="footnote" color="inkMuted">{t('picker.upTo', { n: props.max })}</Txt> : null}
          </View>
          <View style={styles.search}>
            <Icon name="search" size={18} color="inkMuted" />
            <TextInput value={text} onChangeText={setText} placeholder={t('picker.search')} placeholderTextColor={colors.inkSubtle}
              autoCorrect={false} autoCapitalize="words" returnKeyType="search" accessibilityLabel={t('picker.search')}
              style={[styles.searchInput, { fontFamily: fontFamily('medium', locale) }]} testID={`${props.testID}-search`} />
            {text ? <Tap onPress={() => setText('')} accessibilityLabel={t('picker.clear')} style={styles.clear}><Icon name="close-circle" size={18} color="inkSubtle" /></Tap> : null}
          </View>
          <FlatList
            data={shown}
            keyExtractor={(o) => o.value}
            keyboardShouldPersistTaps="handled"
            initialNumToRender={20}
            style={styles.flex}
            ListHeaderComponent={canAdd ? (
              <Tap onPress={add} style={styles.row} accessibilityLabel={t('picker.add', { name: typed })} testID={`${props.testID}-add`}>
                <View style={styles.addIcon}><Icon name="add" size={18} color="navy" /></View>
                <View style={styles.flex}>
                  <Txt variant="bodyStrong" color="navy">{t('picker.add', { name: typed })}</Txt>
                  <Txt variant="caption" color="inkMuted">{t('picker.addSub')}</Txt>
                </View>
              </Tap>
            ) : null}
            ListEmptyComponent={props.loadFailed && !props.loading ? (
              <View style={styles.failed} testID={`${props.testID}-load-failed`}>
                <Icon name="cloud-offline-outline" size={28} color="inkMuted" />
                <Txt variant="callout" color="inkMuted" align="center">{props.onAdd ? t('picker.loadErrorType') : t('picker.loadError')}</Txt>
                {props.onRetry ? <Button label={t('common.retry')} size="sm" variant="secondary" icon="refresh" onPress={props.onRetry} testID={`${props.testID}-retry`} /> : null}
              </View>
            ) : canAdd ? null : <Txt variant="callout" color="inkMuted" align="center" style={styles.empty}>{props.loading ? t('common.loading') : t('picker.none')}</Txt>}
            renderItem={({ item }) => {
              const on = chosen.includes(item.value);
              return (
                <Tap onPress={() => pick(item.value)} style={[styles.row, !on && full && styles.rowOff]} accessibilityRole={props.multiple ? 'checkbox' : 'radio'}
                  accessibilityState={props.multiple ? { checked: on } : { selected: on }} testID={`${props.testID}-option-${item.value}`}>
                  {props.multiple ? (
                    <View style={[styles.box2, on && styles.box2On]}>{on ? <Icon name="checkmark" size={14} color="onNavy" /> : null}</View>
                  ) : <RadioDot on={on} />}
                  <View style={styles.flex}>
                    <Txt variant={on ? 'bodyStrong' : 'body'}>{item.value}</Txt>
                    {item.detail ? <Txt variant="caption" color="inkMuted">{item.detail}</Txt> : null}
                  </View>
                </Tap>
              );
            }}
          />
          {props.multiple ? <Button label={chosen.length > 0 ? t('picker.done', { n: chosen.length }) : t('common.close')} onPress={close} testID={`${props.testID}-done`} /> : null}
        </View>
      </Sheet>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space.xs },
  flex: { flex: 1 },
  box: { flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: 52, paddingHorizontal: space.md, borderWidth: 1.5, borderRadius: radius.md, backgroundColor: colors.surface },
  boxOff: { backgroundColor: colors.surfaceMuted },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs, marginTop: 2 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 4, maxWidth: '100%', minHeight: 32, paddingLeft: space.md, paddingRight: space.sm, borderRadius: radius.pill, backgroundColor: colors.blueTint },
  chipText: { flexShrink: 1 },
  msg: { flexDirection: 'row', gap: space.xs, alignItems: 'flex-start', marginTop: 2 },
  sheetBody: { gap: space.md },
  sheetHead: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  search: { flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: 48, paddingHorizontal: space.md, borderRadius: radius.md, backgroundColor: colors.surfaceMuted },
  searchInput: { flex: 1, fontSize: 16, color: colors.ink, paddingVertical: space.sm },
  clear: { padding: space.xs },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 52, paddingVertical: space.sm, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line },
  rowOff: { opacity: 0.4 },
  addIcon: { width: 28, height: 28, borderRadius: 14, backgroundColor: colors.blueTint, alignItems: 'center', justifyContent: 'center' },
  box2: { width: 24, height: 24, borderRadius: 7, borderWidth: 2, borderColor: colors.lineStrong, alignItems: 'center', justifyContent: 'center' },
  box2On: { backgroundColor: colors.blue, borderColor: colors.blue },
  empty: { paddingVertical: space.xl },
  failed: { alignItems: 'center', gap: space.md, paddingVertical: space.xl },
});
