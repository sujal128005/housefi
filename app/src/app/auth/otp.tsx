// Six-digit code. The code is read from the SMS when the phone allows it (services/otpAutoRead) and fills itself in,
// digit by digit; a correct code turns the boxes green before the next screen. Demo mode shows the code in a labelled
// "Demo SMS" card instead of sending a text message.
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Animated, StyleSheet, TextInput, View } from 'react-native';
import { techHref } from '../../domain/techReview';
import { formatDuration, formatPhone } from '../../i18n/format';
import { useI18n } from '../../i18n/I18n';
import { resetTo } from '../../navigation';
import { isApiError } from '../../services/api';
import { useBackend } from '../../services/ServicesProvider';
import { useAppState } from '../../state/AppState';
import { authFlow } from '../../state/authFlow';
import { colors, radius, shadow, space } from '../../theme/tokens';
import { Banner, Button, ErrorBanner, Header, Icon, Pill, Screen, Tap, Txt, useToast } from '../../ui';
import { feedback } from '../../services/feedback';
import { listenForOtp } from '../../services/otpAutoRead';
import { Pop } from '../../ui/motion';

const LENGTH = 6;

export default function Otp() {
  const { t } = useI18n();
  const backend = useBackend();
  const toast = useToast();
  const { signIn, techSignIn, prefs } = useAppState();
  const asTech = prefs.role === 'TECHNICIAN';
  const [challenge, setChallenge] = useState(authFlow.get());
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [blocked, setBlocked] = useState(false);
  const [left, setLeft] = useState(challenge?.resendAfterSec ?? 0);
  const input = useRef<TextInput>(null);
  const shake = useRef(new Animated.Value(0)).current;
  const [reading, setReading] = useState(false);
  const [verified, setVerified] = useState(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const stopListening = useRef<() => void>(() => undefined);

  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  useEffect(() => {
    if (!challenge) router.replace('/auth/phone');
  }, [challenge]);

  useEffect(() => {
    if (left <= 0) return;
    const id = setTimeout(() => setLeft((s) => s - 1), 1000);
    return () => clearTimeout(id);
  }, [left]);

  /** Types the code in one digit at a time, then checks it. */
  const fillIn = (c: string) => {
    const digits = c.replace(/\D/g, '').slice(0, LENGTH);
    timers.current.forEach(clearTimeout);
    timers.current = Array.from({ length: digits.length }, (_, k) => setTimeout(() => {
      setCode(digits.slice(0, k + 1));
      feedback('select');
      if (k === digits.length - 1 && digits.length === LENGTH) void verify(digits);
    }, 70 * (k + 1)));
  };

  /** A short green moment, then the next screen. */
  const succeed = (go: () => void) => {
    setVerified(true);
    feedback('success');
    timers.current.push(setTimeout(go, 650));
  };

  const doShake = () => {
    Animated.sequence([10, -10, 8, -8, 0].map((v) => Animated.timing(shake, { toValue: v, duration: 50, useNativeDriver: true }))).start();
  };

  const verify = async (value: string) => {
    if (!challenge || value.length !== LENGTH || busy || blocked) return;
    setBusy(true);
    setProblem(null);
    setError(null);
    try {
      if (asTech) {
        const { session, isNew } = await backend.tech.auth.verifyOtp(challenge.challengeId, value);
        authFlow.set(null);
        succeed(() => {
          techSignIn(session);
          resetTo(isNew ? '/tech/setup' : techHref(session.profile, Date.now()));
        });
        return;
      }
      const { session, isNewCustomer } = await backend.auth.verifyOtp(challenge.challengeId, value);
      authFlow.set(null);
      succeed(() => {
        signIn(session);
        resetTo(isNewCustomer ? '/auth/name' : '/home');
      });
    } catch (e) {
      setCode('');
      doShake();
      feedback('error');
      if (isApiError(e, 'OTP_INVALID')) setProblem(t('auth.otp.invalid', { left: e.attemptsLeft ?? 0 }));
      else if (isApiError(e, 'OTP_EXPIRED')) {
        setProblem(t('auth.otp.expired'));
        setBlocked(true);
      } else if (isApiError(e, 'OTP_LOCKED')) {
        setProblem(t('auth.otp.locked'));
        setBlocked(true);
      } else setError(e);
    } finally {
      setBusy(false);
    }
  };

  const resend = async () => {
    if (!challenge) return;
    setError(null);
    try {
      const next = await (asTech ? backend.tech.auth.requestOtp(challenge.phone) : backend.auth.requestOtp(challenge.phone));
      authFlow.set(next);
      setChallenge(next);
      setCode('');
      setProblem(null);
      setBlocked(false);
      setLeft(next.resendAfterSec);
      toast.show(t('auth.otp.resent'), 'chatbubble-ellipses');
    } catch (e) {
      setError(e);
    }
  };

  const onChange = (v: string) => {
    if (verified) return;
    stopListening.current();
    timers.current.forEach(clearTimeout);
    const d = v.replace(/\D/g, '').slice(0, LENGTH);
    setCode(d);
    if (problem && !blocked) setProblem(null);
    if (d.length === LENGTH) void verify(d);
  };

  // Listen for the SMS while the code is still needed; typing stops it.
  useEffect(() => {
    if (!challenge || blocked) return;
    setReading(true);
    const stop = listenForOtp((c) => {
      setReading(false);
      fillIn(c);
    }, { demoCode: challenge.demoCode });
    stopListening.current = () => {
      stop();
      setReading(false);
    };
    return stop;
    // fillIn is stable for a given challenge
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [challenge, blocked]);

  if (!challenge) return null;
  return (
    <Screen
      testID="auth-otp"
      wash="sky"
      header={<Header />}
      footer={<Button label={t('auth.otp.verify')} onPress={() => void verify(code)} loading={busy || verified} disabled={code.length < LENGTH || blocked} testID="otp-verify" />}
    >
      {challenge.demoCode ? (
        <View style={styles.sms} testID="demo-sms">
          <View style={styles.smsIcon}><Icon name="chatbubble-ellipses" size={20} color="onNavy" /></View>
          <View style={styles.flex}>
            <Txt variant="caption" color="demo">{t('common.demo')}</Txt>
            <Txt variant="callout" testID="demo-sms-text">{t('auth.otp.demoSms', { code: challenge.demoCode })}</Txt>
          </View>
          <Tap onPress={() => { stopListening.current(); fillIn(challenge.demoCode ?? ''); }} style={styles.fill} accessibilityLabel={t('auth.otp.fill')} testID="demo-fill" disabled={blocked || verified}>
            <Txt variant="label" color="blue">{t('auth.otp.fill')}</Txt>
          </Tap>
        </View>
      ) : null}
      {challenge.demoAccount ? (
        <View style={styles.demoAccount} testID="demo-account">
          <Pill label={t('auth.otp.demoAccount')} tone="demo" icon="flask" />
          <Txt variant="footnote" color="inkMuted" style={styles.flex}>{t('auth.otp.demoAccountBody')}</Txt>
        </View>
      ) : null}

      <Txt variant="title1" heading>{t('auth.otp.title')}</Txt>
      <View style={styles.sub}>
        <Txt variant="body" color="inkMuted">{t('auth.otp.body', { phone: formatPhone(challenge.phone) })}</Txt>
        <Tap onPress={() => router.back()} style={styles.change} accessibilityLabel={t('auth.otp.change')} testID="otp-change">
          <Txt variant="label" color="blue">{t('auth.otp.change')}</Txt>
        </Tap>
      </View>

      <Tap testID="otp-boxes" onPress={() => input.current?.focus()} scale={1} accessibilityLabel={t('auth.otp.title')} accessibilityHint={t('auth.otp.body', { phone: formatPhone(challenge.phone) })}>
        <Animated.View style={[styles.boxes, { transform: [{ translateX: shake }] }]}>
          {Array.from({ length: LENGTH }, (_, k) => {
            const ch = code[k] ?? '';
            const active = k === Math.min(code.length, LENGTH - 1) && !blocked;
            return (
              <View key={k} style={[styles.box, active && styles.boxActive, problem && styles.boxError, ch !== '' && styles.boxFilled, verified && styles.boxOk]}>
                {ch !== '' ? <Pop><Txt variant="title1" align="center" color={verified ? 'success' : 'ink'}>{ch}</Txt></Pop> : null}
              </View>
            );
          })}
        </Animated.View>
      </Tap>
      <TextInput
        ref={input}
        testID="otp-input"
        value={code}
        onChangeText={onChange}
        keyboardType="number-pad"
        textContentType="oneTimeCode"
        autoComplete="sms-otp"
        maxLength={LENGTH}
        autoFocus
        editable={!blocked}
        style={styles.hiddenInput}
        accessibilityLabel={t('auth.otp.title')}
      />

      {verified ? (
        <Pop style={styles.status}>
          <Icon name="checkmark-circle" size={22} color="success" />
          <Txt variant="label" color="success" testID="otp-verified">{t('auth.otp.verified')}</Txt>
        </Pop>
      ) : reading && code.length === 0 ? (
        <View style={styles.status} testID="otp-reading">
          <ActivityIndicator size="small" color={colors.blue} />
          <Txt variant="callout" color="inkMuted">{t('auth.otp.reading')}</Txt>
        </View>
      ) : null}
      {problem ? <Banner tone="danger" text={problem} testID="otp-problem" /> : null}
      <ErrorBanner error={error} />

      <View style={styles.resendRow}>
        {left > 0 ? (
          <Txt variant="callout" color="inkMuted" testID="otp-timer">{t('auth.otp.resendIn', { time: formatDuration(left) })}</Txt>
        ) : (
          <Tap onPress={() => void resend()} style={styles.resend} accessibilityLabel={t('auth.otp.resend')} testID="otp-resend">
            <Icon name="refresh" size={18} color="blue" />
            <Txt variant="label" color="blue">{t('auth.otp.resend')}</Txt>
          </Tap>
        )}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  demoAccount: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  flex: { flex: 1 },
  sms: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md, borderRadius: radius.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.demoTint, ...shadow.card },
  smsIcon: { width: 40, height: 40, borderRadius: radius.icon, backgroundColor: colors.demo, alignItems: 'center', justifyContent: 'center' },
  fill: { minHeight: 44, minWidth: 48, justifyContent: 'center', alignItems: 'center' },
  sub: { gap: 0 },
  change: { alignSelf: 'flex-start', minHeight: 40, justifyContent: 'center' },
  boxes: { flexDirection: 'row', gap: space.sm, justifyContent: 'space-between' },
  box: { flex: 1, aspectRatio: 0.82, maxWidth: 56, borderRadius: radius.md, borderWidth: 2, borderColor: colors.line, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  boxActive: { borderColor: colors.blue },
  boxFilled: { borderColor: colors.navy },
  boxError: { borderColor: colors.danger },
  boxOk: { borderColor: colors.success, backgroundColor: colors.successTint },
  status: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.sm, minHeight: 28 },
  hiddenInput: { position: 'absolute', opacity: 0, height: 1, width: 1 },
  resendRow: { alignItems: 'center' },
  resend: { flexDirection: 'row', alignItems: 'center', gap: space.xs, minHeight: 48, paddingHorizontal: space.md },
});
