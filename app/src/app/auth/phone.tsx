// Sign in / sign up with a mobile number. One flow for both: new numbers get a name step after the code.
import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { nationalDigits, normalizePhone } from '../../domain/rules';
import { Art3D } from '../../illustrations/Art3D';
import { useI18n } from '../../i18n/I18n';
import { useBackend, useIsDemo } from '../../services/ServicesProvider';
import { backOrStart } from '../../navigation';
import { useAppState } from '../../state/AppState';
import { authFlow } from '../../state/authFlow';
import { space } from '../../theme/tokens';
import { Banner, Button, ErrorBanner, Field, Header, Pill, Screen, Tap, Txt } from '../../ui';
import { useSingleFlight } from '../../ui/useSingleFlight';

/** "9876543210" -> "98765 43210" while typing; a pasted or autofilled "+91 98765 43210" becomes the same. */
function formatTyping(raw: string): string {
  const d = nationalDigits(raw);
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
  // The keyboard's Done and the button: one code request at a time (each request is an SMS).
  const once = useSingleFlight();

  const digits = value.replace(/\D/g, '');
  const phone = normalizePhone(digits);
  const showInvalid = (touched || digits.length === 10) && !phone;

  const send = () => once(async () => {
    setTouched(true);
    if (!phone) return;
    setBusy(true);
    setError(null);
    try {
      // Customer and technician accounts are separate: the code is for the account this app section signs in to.
      const challenge = await (asTech ? backend.tech.auth.requestOtp(phone) : backend.auth.requestOtp(phone));
      authFlow.set(challenge);
      router.push('/auth/otp');
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  });

  return (
    <Screen
      testID="auth-phone"
      wash="sky"
      header={<Header onBack={backOrStart} />}
      footer={<Button label={t('auth.phone.send')} trailingIcon="arrow-forward" onPress={() => void send()} loading={busy} disabled={!phone} testID="phone-send" />}
    >
      <View style={styles.art}><Art3D name={asTech ? 'tech_hero' : 'key'} size={120} float shadow /></View>
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
        placeholder="98765 43210"
        returnKeyType="done"
        onSubmitEditing={() => void send()}
        error={showInvalid ? t('auth.phone.invalid') : null}
        hint={t('auth.phone.hint')}
      />
      {isDemo ? <Banner tone="demo" text={t('auth.phone.demo')} /> : null}
      <ErrorBanner error={error} />
      <View style={styles.terms}>
        <Txt variant="footnote" color="inkMuted" align="center">{t('auth.phone.terms')}</Txt>
        <Tap onPress={() => router.push('/legal')} style={styles.termsLink} accessibilityRole="link" accessibilityLabel={t('auth.phone.readTerms')} testID="read-terms">
          <Txt variant="label" color="blue">{t('auth.phone.readTerms')}</Txt>
        </Tap>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  art: { alignItems: 'center', marginTop: -space.md },
  roleTag: { alignItems: 'flex-start' },
  terms: { alignItems: 'center', gap: 2 },
  termsLink: { minHeight: 44, justifyContent: 'center', paddingHorizontal: space.sm },
});
