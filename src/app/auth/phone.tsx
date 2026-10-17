// Sign in / sign up with a mobile number. One flow for both: new numbers get a name step after the code.
import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { normalizePhone } from '../../domain/rules';
import { Art3D } from '../../illustrations/Art3D';
import { useI18n } from '../../i18n/I18n';
import { useBackend, useIsDemo } from '../../services/ServicesProvider';
import { useAppState } from '../../state/AppState';
import { authFlow } from '../../state/authFlow';
import { colors, space } from '../../theme/tokens';
import { Banner, Button, ErrorBanner, Field, Header, NotInDemoSheet, Pill, Screen, Tap, Txt } from '../../ui';

/** "9876543210" -> "98765 43210" while typing. */
function formatTyping(raw: string): string {
  const d = raw.replace(/\D/g, '').slice(0, 10);
  return d.length > 5 ? `${d.slice(0, 5)} ${d.slice(5)}` : d;
}

export default function PhoneSignIn() {
  const { t } = useI18n();
  const backend = useBackend();
  /** Labels about simulated backend outcomes show only with the demo backend. */
  const isDemo = useIsDemo();
  const { prefs } = useAppState();
  const asTech = prefs.role === 'TECHNICIAN';
  const [value, setValue] = useState('');
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [social, setSocial] = useState<string | null>(null);

  const digits = value.replace(/\D/g, '');
  const phone = normalizePhone(digits);
  const showInvalid = (touched || digits.length === 10) && !phone;

  const send = async () => {
    setTouched(true);
    if (!phone) return;
    setBusy(true);
    setError(null);
    try {
      const challenge = await backend.auth.requestOtp(phone);
      authFlow.set(challenge);
      router.push('/auth/otp');
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen
      testID="auth-phone"
      wash="sky"
      header={<Header />}
      footer={<Button label={t('auth.phone.send')} trailingIcon="arrow-forward" onPress={send} loading={busy} disabled={!phone} testID="phone-send" />}
    >
      <View style={styles.art}><Art3D name={asTech ? 'tech_hero' : 'key'} size={110} float shadow /></View>
      {asTech ? <View style={styles.roleTag}><Pill label={t('auth.phone.asTech')} tone="info" icon="construct" /></View> : null}
      <Txt variant="title1" heading>{asTech ? t('auth.phone.titleTech') : t('auth.phone.title')}</Txt>
      <Field
        testID="phone-input"
        label={t('auth.phone.label')}
        prefix="+91"
        large
        value={value}
        onChangeText={(v) => setValue(formatTyping(v))}
        onBlur={() => setTouched(digits.length > 0)}
        keyboardType="number-pad"
        textContentType="telephoneNumber"
        autoComplete="tel"
        maxLength={11}
        placeholder="98765 43210"
        returnKeyType="done"
        onSubmitEditing={send}
        error={showInvalid ? t('auth.phone.invalid') : null}
        hint={t('auth.phone.hint')}
      />
      {isDemo ? <Banner tone="demo" text={t('auth.phone.demo')} /> : null}
      <ErrorBanner error={error} />
      <View style={styles.orRow}>
        <View style={styles.rule} />
        <Txt variant="footnote" color="inkMuted">{t('auth.phone.or')}</Txt>
        <View style={styles.rule} />
      </View>
      <View style={styles.socialRow}>
        <Button label="Google" icon="logo-google" variant="outline" size="md" tag={t('common.soon')} onPress={() => setSocial('Google')} style={styles.flex} />
        <Button label="Apple" icon="logo-apple" variant="outline" size="md" tag={t('common.soon')} onPress={() => setSocial('Apple')} style={styles.flex} />
      </View>
      <View style={styles.terms}>
        <Txt variant="footnote" color="inkMuted" align="center">{t('auth.phone.terms')}</Txt>
        <Tap onPress={() => router.push('/legal')} style={styles.termsLink} accessibilityRole="link" accessibilityLabel={t('auth.phone.readTerms')} testID="read-terms">
          <Txt variant="label" color="blue">{t('auth.phone.readTerms')}</Txt>
        </Tap>
      </View>
      <NotInDemoSheet visible={social !== null} title={social ?? undefined} onClose={() => setSocial(null)} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  art: { alignItems: 'center', marginTop: -space.md },
  roleTag: { alignItems: 'flex-start' },
  orRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  rule: { flex: 1, height: 1, backgroundColor: colors.line },
  socialRow: { flexDirection: 'row', gap: space.md },
  terms: { alignItems: 'center', gap: 2 },
  termsLink: { minHeight: 44, justifyContent: 'center', paddingHorizontal: space.sm },
});
