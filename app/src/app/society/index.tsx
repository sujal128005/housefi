// Society repair day: plan a day for the whole building, or join one with the code a neighbour shared.
import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { categoryById } from '../../data/catalog';
import { parseIsoDate } from '../../domain/rules';
import { Art3D } from '../../illustrations/Art3D';
import { formatDate, formatRupees } from '../../i18n/format';
import { useI18n } from '../../i18n/I18n';
import { useBackend, useQuery } from '../../services/ServicesProvider';
import { useSession } from '../../state/AppState';
import { space } from '../../theme/tokens';
import { Button, Card, Field, Header, Icon, Pill, Screen, Tap, Txt } from '../../ui';

export default function SocietyHome() {
  const { t, l, locale } = useI18n();
  const backend = useBackend();
  const session = useSession();
  const [code, setCode] = useState('');
  const mine = useQuery(() => backend.bookings.mySocieties(session.token), [backend, session.token]);
  const clean = code.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');

  return (
    <Screen testID="society-home" wash="sky" header={<Header title={t('soc.title')} />}>
      <View style={styles.hero}><Art3D name="house_garden" size={110} float shadow /></View>
      <Txt variant="title1" align="center" heading>{t('soc.heading')}</Txt>
      <Txt variant="callout" color="inkMuted" align="center">{t('soc.body', { fee: formatRupees(25), usual: formatRupees(49), min: 4 })}</Txt>

      <Card style={styles.card}>
        <Txt variant="title3" heading>{t('soc.planTitle')}</Txt>
        <Txt variant="footnote" color="inkMuted">{t('soc.planSub')}</Txt>
        <Button label={t('soc.plan')} icon="calendar" onPress={() => router.push('/society/new')} testID="soc-plan" />
      </Card>

      <Card style={styles.card}>
        <Txt variant="title3" heading>{t('soc.joinTitle')}</Txt>
        <Field label={t('soc.code')} value={code} onChangeText={setCode} autoCapitalize="characters" maxLength={8} testID="soc-code" />
        <Button label={t('soc.join')} icon="enter-outline" variant="secondary" disabled={clean.length !== 6} onPress={() => router.push(`/society/${clean}`)} testID="soc-join" />
      </Card>

      {mine.data?.length ? (
        <>
          <Txt variant="label" color="inkMuted">{t('soc.mine')}</Txt>
          {mine.data.map((d) => {
            const c = categoryById(d.categoryId);
            return (
              <Tap key={d.code} onPress={() => router.push(`/society/${d.code}`)} style={styles.row} testID={`soc-mine-${d.code}`} accessibilityLabel={d.name}>
                <View style={styles.flex}>
                  <Txt variant="bodyStrong">{d.name}</Txt>
                  <Txt variant="footnote" color="inkMuted">{c ? l(c.name) : ''} · {formatDate(parseIsoDate(d.time.window.date), locale)}</Txt>
                </View>
                <Pill tone={d.state === 'CANCELLED' ? 'neutral' : d.state === 'OPEN' ? 'info' : 'success'} label={t(`soc.state.${d.state}`)} />
                <Icon name="chevron-forward" size={18} color="inkSubtle" />
              </Tap>
            );
          })}
        </>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: { alignItems: 'center', marginTop: space.sm },
  card: { gap: space.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md, borderRadius: 16, backgroundColor: 'white' },
  flex: { flex: 1 },
});
