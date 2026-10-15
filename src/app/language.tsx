// Language: English or Telugu. The whole app switches immediately. Opened again from Account to change it.
import { router, useLocalSearchParams } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { GlobeArt } from '../illustrations/Scenes';
import type { Locale } from '../i18n/format';
import { useI18n } from '../i18n/I18n';
import { useAppState } from '../state/AppState';
import { space } from '../theme/tokens';
import { Button, Header, Screen, Txt } from '../ui';
import { ChoiceCard } from '../ui/ChoiceCard';

const OPTIONS: readonly { code: Locale; title: string; sub: string; glyph: string }[] = [
  { code: 'en', title: 'English', sub: 'English', glyph: 'Aa' },
  { code: 'te', title: 'తెలుగు', sub: 'Telugu', glyph: 'అ' },
];

export default function Language() {
  const { t, locale } = useI18n();
  const { setLocale } = useAppState();
  const { from } = useLocalSearchParams<{ from?: string }>();
  const fromAccount = from === 'account';

  return (
    <Screen
      testID="language"
      wash="lavender"
      header={<Header back={router.canGoBack()} demo={false} />}
      footer={<Button label={t('common.continue')} trailingIcon="arrow-forward" testID="language-continue" onPress={() => {
        setLocale(locale);
        if (fromAccount) router.back();
        else router.push('/role');
      }} />}
    >
      <View style={styles.art}><GlobeArt size={180} /></View>
      <Txt variant="title1" heading>{t('language.title')}</Txt>
      <Txt variant="body" color="inkMuted">{t('language.body')}</Txt>
      <View style={styles.list}>
        {OPTIONS.map((o) => (
          <ChoiceCard
            key={o.code}
            testID={`lang-${o.code}`}
            title={o.title}
            titleLang={o.code}
            subtitle={o.sub}
            selected={locale === o.code}
            onPress={() => setLocale(o.code)}
            art={<Txt variant="title2" color="blue" weight="extrabold" lang={o.code}>{o.glyph}</Txt>}
          />
        ))}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  art: { alignItems: 'center', marginTop: -space.md },
  list: { gap: space.md, marginTop: space.sm },
});
