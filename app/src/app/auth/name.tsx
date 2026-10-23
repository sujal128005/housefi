// First sign-in only: the customer's name. Also used from Account to change it (?edit=1).
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { isValidName } from '../../domain/rules';
import { Art3D } from '../../illustrations/Art3D';
import { useI18n } from '../../i18n/I18n';
import { backOrStart, resetTo } from '../../navigation';
import { useBackend } from '../../services/ServicesProvider';
import { useAppState } from '../../state/AppState';
import { Button, ErrorBanner, Field, Header, Screen, Txt } from '../../ui';
import { useSingleFlight } from '../../ui/useSingleFlight';

export default function NameStep() {
  const { t } = useI18n();
  const backend = useBackend();
  const { session, updateCustomer } = useAppState();
  const { edit } = useLocalSearchParams<{ edit?: string }>();
  const editing = edit === '1';
  const [name, setName] = useState(session?.customer.name ?? '');
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const valid = isValidName(name);
  const once = useSingleFlight();

  const save = () => once(async () => {
    setTouched(true);
    if (!valid || !session) return;
    setBusy(true);
    setError(null);
    try {
      const c = await backend.auth.updateName(session.token, name);
      updateCustomer(c);
      if (editing) router.back();
      else resetTo('/home');
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  });

  return (
    <Screen
      testID="auth-name"
      wash="peach"
      // Editing goes back to the account; during registration back leads to the customer / technician choice.
      header={<Header onBack={editing ? undefined : backOrStart} />}
      footer={<Button label={editing ? t('common.save') : t('common.continue')} onPress={() => void save()} loading={busy} disabled={name.trim().length === 0} testID="name-save" />}
    >
      <View style={styles.art}><Art3D name="wave" size={120} float shadow /></View>
      <Txt variant="title1" heading>{t('auth.profile.title')}</Txt>
      <Txt variant="body" color="inkMuted">{t('auth.profile.body')}</Txt>
      <Field
        testID="name-input"
        label={t('auth.profile.name')}
        value={name}
        onChangeText={setName}
        placeholder={t('auth.profile.placeholder')}
        autoCapitalize="words"
        autoComplete="name"
        textContentType="name"
        maxLength={60}
        returnKeyType="done"
        onSubmitEditing={() => void save()}
        error={touched && !valid ? t('auth.profile.invalid') : null}
      />
      <ErrorBanner error={error} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  art: { alignItems: 'center' },
});
