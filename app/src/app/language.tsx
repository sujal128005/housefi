// Language: English or Telugu. The whole app switches immediately. Opened again from Account / Profile to change it.
// "Detect from my location" (coming soon, works for English and Telugu today) picks the language spoken where the
// phone is, e.g. Kurnool -> Telugu, Delhi -> Hindi (not in the app yet, so it stays on English).
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { languageForPlace, LANGUAGE_NAMES, type LanguageGuess } from '../domain/language';
import { Art3D } from '../illustrations/Art3D';
import type { Locale } from '../i18n/format';
import { useI18n } from '../i18n/I18n';
import { locate } from '../services/device';
import { feedback } from '../services/feedback';
import { useAppState } from '../state/AppState';
import { colors, radius, space } from '../theme/tokens';
import { Banner, Button, Header, Pill, Screen, Txt } from '../ui';
import { ChoiceCard } from '../ui/ChoiceCard';

const OPTIONS: readonly { code: Locale; title: string; sub: string; glyph: string }[] = [
  { code: 'en', title: 'English', sub: 'English', glyph: 'Aa' },
  { code: 'te', title: 'తెలుగు', sub: 'Telugu', glyph: 'అ' },
];

type Detect = { readonly state: 'IDLE' | 'BUSY' } | { readonly state: 'DONE'; readonly place: string; readonly guess: LanguageGuess } | { readonly state: 'FAILED'; readonly reason: 'DENIED' | 'OFF' | 'UNAVAILABLE' };

export default function Language() {
  const { t, locale } = useI18n();
  const { setLocale } = useAppState();
  const { from } = useLocalSearchParams<{ from?: string }>();
  const fromAccount = from === 'account';
  const [detect, setDetect] = useState<Detect>({ state: 'IDLE' });

  const run = async () => {
    setDetect({ state: 'BUSY' });
    const r = await locate();
    if (!r.ok) {
      feedback('warning');
      setDetect({ state: 'FAILED', reason: r.reason });
      return;
    }
    const guess = languageForPlace(r.place.city, r.place.region);
    const place = [r.place.city, r.place.region].filter(Boolean).join(', ');
    if (guess.supported) {
      setLocale(guess.language as Locale);
      feedback('success');
    } else feedback('pop');
    setDetect({ state: 'DONE', place: place || t('language.detectUnknown'), guess });
  };

  return (
    <Screen
      testID="language"
      wash="lavender"
      header={<Header back={router.canGoBack()} demo={false} />}
      footer={<Button label={t('common.continue')} trailingIcon="arrow-forward" testID="language-continue" onPress={() => {
        setLocale(locale);
        if (fromAccount) {
          if (router.canGoBack()) router.back();
          else router.replace('/');
        } else router.push('/role');
      }} />}
    >
      <View style={styles.art}><Art3D name="globe" size={140} float shadow /></View>
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

      <View style={styles.detect} testID="language-detect">
        <View style={styles.detectHead}>
          <Art3D name="pin" size={44} />
          <View style={styles.flex}>
            <Txt variant="bodyStrong">{t('language.detect')}</Txt>
            <Txt variant="footnote" color="inkMuted">{t('language.detectBody')}</Txt>
          </View>
          <Pill label={t('common.soon')} tone="demo" icon="sparkles" />
        </View>
        <Button label={t('language.detectCta')} icon="locate" variant="secondary" size="md" loading={detect.state === 'BUSY'} onPress={() => void run()} testID="language-detect-run" />
        {detect.state === 'DONE' ? (
          <Banner tone={detect.guess.supported ? 'success' : 'info'} icon={detect.guess.supported ? 'checkmark-circle' : 'information-circle'} testID="language-detect-result"
            text={detect.guess.supported
              ? t('language.detectSet', { place: detect.place, language: LANGUAGE_NAMES[detect.guess.language] })
              : t('language.detectSoon', { place: detect.place, language: LANGUAGE_NAMES[detect.guess.language] })} />
        ) : null}
        {detect.state === 'FAILED' ? (
          <Banner tone="warning" testID="language-detect-failed"
            text={detect.reason === 'DENIED' ? t('language.detectDenied') : detect.reason === 'OFF' ? t('address.locOff') : t('language.detectFailed')} />
        ) : null}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  art: { alignItems: 'center', marginTop: -space.md },
  list: { gap: space.md, marginTop: space.sm },
  detect: { gap: space.md, padding: space.lg, borderRadius: radius.xl, backgroundColor: colors.surface, borderWidth: 1, borderStyle: 'dashed', borderColor: colors.demo },
  detectHead: { flexDirection: 'row', alignItems: 'center', gap: space.md },
});
