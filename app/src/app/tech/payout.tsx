// Technician: where the weekly payout goes (Profile -> Payout details): a bank account with its IFSC, or a UPI ID.
// The server keeps the number / UPI ID encrypted and only ever shows them masked; a change is confirmed by Housefi by
// phone before the next payout.
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { payoutProblems, tidyPayout, type PayoutField } from '../../domain/payout';
import type { PayoutAccount } from '../../domain/types';
import { useI18n } from '../../i18n/I18n';
import { useBackend } from '../../services/ServicesProvider';
import { useTechSession } from '../../state/AppState';
import { space } from '../../theme/tokens';
import { Banner, Button, ErrorBanner, Field, Header, Screen, Segmented, Skeleton, Txt, useToast } from '../../ui';

export default function PayoutDetails() {
  const { t } = useI18n();
  const backend = useBackend();
  const session = useTechSession();
  const toast = useToast();
  const [current, setCurrent] = useState<PayoutAccount | null | undefined>(undefined);
  const [rail, setRail] = useState<'BANK' | 'UPI'>('BANK');
  const [holderName, setHolderName] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const [confirmAccount, setConfirmAccount] = useState('');
  const [ifsc, setIfsc] = useState('');
  const [upiId, setUpiId] = useState('');
  const [shown, setShown] = useState<readonly PayoutField[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    let alive = true;
    void backend.tech.payoutAccount(session.token).then((a) => {
      if (!alive) return;
      setCurrent(a);
      if (a) {
        setRail(a.rail);
        setHolderName(a.holderName);
      }
    }).catch((e: unknown) => {
      if (!alive) return;
      setCurrent(null);
      setError(e);
    });
    return () => {
      alive = false;
    };
  }, [backend, session.token]);

  const input = { rail, holderName, accountNumber, ifsc, upiId };
  const msg = (f: PayoutField) => (shown.includes(f) ? t(`payout.err.${f}`) : undefined);

  const save = async () => {
    const problems = payoutProblems(input, confirmAccount);
    setShown(problems);
    if (problems.length) return;
    setBusy(true);
    setError(null);
    try {
      setCurrent(await backend.tech.setPayoutAccount(session.token, tidyPayout(input)));
      toast.show(t('payout.saved'), 'checkmark-circle');
      router.back();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen
      testID="tech-payout"
      header={<Header title={t('payout.title')} />}
      footer={<Button label={current ? t('payout.change') : t('payout.save')} onPress={() => void save()} loading={busy} disabled={current === undefined} testID="payout-save" />}
    >
      {current === undefined ? <><Skeleton style={styles.skel} /><Skeleton style={styles.skel} /></> : (
        <>
          {current ? (
            <View style={styles.now} testID="payout-current">
              <Txt variant="label">{t('payout.now')}</Txt>
              <Txt variant="title3">{current.hint}</Txt>
              <Txt variant="caption" color="inkMuted">{current.holderName} · {current.rail === 'BANK' ? t('payout.bank') : t('payout.upi')}</Txt>
            </View>
          ) : (
            <Banner tone="info" icon="wallet-outline" text={t('payout.intro')} testID="payout-intro" />
          )}
          <Segmented value={rail} onChange={(v) => { setRail(v); setShown([]); }} options={[{ value: 'BANK', label: t('payout.bank') }, { value: 'UPI', label: t('payout.upi') }]} />
          <Field testID="payout-holder" label={t('payout.holder')} hint={t('payout.holderHint')} value={holderName} onChangeText={setHolderName} error={msg('holderName')} maxLength={60} autoCapitalize="words" />
          {rail === 'BANK' ? (
            <>
              <Field testID="payout-account" label={t('payout.account')} value={accountNumber} onChangeText={(v) => setAccountNumber(v.replace(/\D/g, '').slice(0, 18))} error={msg('accountNumber')} keyboardType="number-pad" secureTextEntry maxLength={18} />
              <Field testID="payout-account-confirm" label={t('payout.accountAgain')} value={confirmAccount} onChangeText={(v) => setConfirmAccount(v.replace(/\D/g, '').slice(0, 18))} error={msg('confirmAccount')} keyboardType="number-pad" maxLength={18} />
              <Field testID="payout-ifsc" label={t('payout.ifsc')} hint={t('payout.ifscHint')} value={ifsc} onChangeText={(v) => setIfsc(v.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 11))} error={msg('ifsc')} autoCapitalize="characters" maxLength={11} placeholder="SBIN0001234" />
            </>
          ) : (
            <Field testID="payout-upi" label={t('payout.upiId')} hint={t('payout.upiHint')} value={upiId} onChangeText={(v) => setUpiId(v.trim())} error={msg('upiId')} autoCapitalize="none" keyboardType="email-address" maxLength={120} placeholder="name@okicici" />
          )}
          <Banner tone="info" icon="shield-checkmark-outline" text={t('payout.safe')} />
          <ErrorBanner error={error} />
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  skel: { height: 56, borderRadius: 14 },
  now: { gap: space.xs },
});
