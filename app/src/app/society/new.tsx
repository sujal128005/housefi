// Plan a society repair day: the building's name, the trade, the day and window, and the organiser's own address (it
// gives the area; neighbours book with their own flat).
import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { CATEGORIES } from '../../data/catalog';
import { parseIsoDate } from '../../domain/rules';
import type { CategoryId } from '../../domain/types';
import { formatDate, formatWindow } from '../../i18n/format';
import { useI18n } from '../../i18n/I18n';
import { useBackend, useQuery } from '../../services/ServicesProvider';
import { useSession } from '../../state/AppState';
import { space } from '../../theme/tokens';
import { Banner, Button, Card, Chip, ErrorBanner, Field, Header, Screen, Txt } from '../../ui';
import { addressLine } from '../../ui/present';

const WINDOWS: readonly (readonly [number, number])[] = [[8, 10], [10, 12], [12, 14], [14, 16], [16, 18], [18, 20]];
/** The day after tomorrow up to two weeks ahead (neighbours need time to join; the day is decided the evening before). */
function days(now = Date.now()): string[] {
  const ist = new Date(now + 5.5 * 60 * 60_000);
  const base = Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate());
  return Array.from({ length: 12 }, (_, k) => new Date(base + (k + 2) * 86_400_000).toISOString().slice(0, 10));
}

export default function PlanSociety() {
  const { t, l, locale } = useI18n();
  const backend = useBackend();
  const session = useSession();
  const addresses = useQuery(() => backend.addresses.list(session.token), [backend, session.token]);
  const [name, setName] = useState('');
  const [categoryId, setCategoryId] = useState<CategoryId>('PLUMBING');
  const [date, setDate] = useState(() => days()[0]!);
  const [window, setWindow] = useState<readonly [number, number]>([10, 12]);
  const [addressId, setAddressId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const chosen = addressId ?? addresses.data?.[0]?.id ?? null;
  const ready = name.trim().length >= 2 && !!chosen;

  const create = async () => {
    if (!chosen) return;
    setBusy(true);
    setError(null);
    try {
      const day = await backend.bookings.planSociety(session.token, { name: name.trim(), categoryId, addressId: chosen, window: { date, startHour: window[0], endHour: window[1] } });
      router.replace(`/society/${day.code}`);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen testID="society-new" header={<Header title={t('soc.planTitle')} />}
      footer={<Button label={t('soc.create')} icon="checkmark" onPress={() => void create()} loading={busy} disabled={!ready} testID="soc-create" />}>
      <Field label={t('soc.name')} value={name} onChangeText={setName} maxLength={60} placeholder={t('soc.namePh')} testID="soc-name" />
      <Txt variant="label">{t('soc.trade')}</Txt>
      <View style={styles.chips}>
        {CATEGORIES.map((c) => <Chip key={c.id} label={l(c.name)} selected={c.id === categoryId} onPress={() => setCategoryId(c.id)} testID={`soc-cat-${c.id}`} />)}
      </View>
      <Txt variant="label">{t('soc.day')}</Txt>
      <View style={styles.chips}>
        {days().map((d) => <Chip key={d} label={formatDate(parseIsoDate(d), locale)} selected={d === date} onPress={() => setDate(d)} testID={`soc-day-${d}`} />)}
      </View>
      <Txt variant="label">{t('soc.window')}</Txt>
      <View style={styles.chips}>
        {WINDOWS.map((w) => <Chip key={w[0]} label={formatWindow(w[0], w[1], locale)} selected={w[0] === window[0]} onPress={() => setWindow(w)} testID={`soc-win-${w[0]}`} />)}
      </View>
      <Txt variant="label">{t('soc.address')}</Txt>
      {addresses.data?.length ? addresses.data.map((a) => (
        <Chip key={a.id} label={`${addressLine(a)}, ${a.pincode}`} selected={a.id === chosen} onPress={() => setAddressId(a.id)} testID={`soc-addr-${a.id}`} />
      )) : <Banner tone="info" text={t('soc.noAddress')} />}
      <Card style={styles.note}>
        <Txt variant="footnote" color="inkMuted">{t('soc.planNote', { min: 4 })}</Txt>
      </Card>
      <ErrorBanner error={error} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  note: { gap: space.sm },
});
