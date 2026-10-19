// Step 4 of 4: confirm & pay. Summary, optional "rated highly by women" preference, price (₹49 visit fee now; repair
// quoted after inspection), payment method, then pay. The booking is created here and waits for the payment.
import { randomUUID } from 'expo-crypto';
import { Redirect, router } from 'expo-router';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { StyleSheet, Switch, View } from 'react-native';
import { categoryById, serviceById } from '../../data/catalog';
import { QUOTE_MIN } from '../../domain/rules';
import { Art3D, type ArtName } from '../../illustrations/Art3D';
import { formatRupees } from '../../i18n/format';
import { useI18n } from '../../i18n/I18n';
import { isApiError } from '../../services/api';
import { useBackend, useIsDemo, useQuery } from '../../services/ServicesProvider';
import { useSession } from '../../state/AppState';
import { useDraft } from '../../state/BookingDraft';
import { idempotencyKeys, outcomeUnknown } from '../../state/idempotency';
import { colors, radius, space } from '../../theme/tokens';
import { Banner, Button, Card, Divider, ErrorBanner, Icon, Pill, RadioDot, Screen, Tap, Txt, type IconName } from '../../ui';
import { CategoryBadge } from '../../ui/CategoryTile';
import { addressLine, visitTimeText } from '../../ui/present';
import { VISIT_METHODS } from '../../ui/payMethods';
import { StepHeader } from '../../ui/StepHeader';
import { markPayIntent } from '../../state/payIntent';
import { withdrawUnpaid } from '../../state/withdrawUnpaid';

export default function ConfirmStep() {
  const { t, l, locale } = useI18n();
  const backend = useBackend();
  /** Labels about simulated backend outcomes show only with the demo backend. */
  const isDemo = useIsDemo();
  const session = useSession();
  const { draft, setPreferWomenRated, setMethod } = useDraft();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const created = useRef<string | null>(null);
  const mounted = useRef(true);
  // One key per booking attempt: a retry after a lost answer gets the booking already created, not a second one.
  const [createKeys] = useState(() => idempotencyKeys(randomUUID));
  const addresses = useQuery(() => backend.addresses.list(session.token), [backend, session.token]);

  // A booking created here but never paid is withdrawn when the customer leaves this step.
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (created.current) void withdrawUnpaid(backend, session.token, created.current);
    };
  }, [backend, session.token]);

  const svc = draft.serviceId ? serviceById(draft.serviceId) : undefined;
  if (!svc || !draft.time || !draft.addressId) return <Redirect href="/home" />;
  const cat = categoryById(svc.categoryId);
  const address = addresses.data?.find((a) => a.id === draft.addressId);
  const p = draft.problem;
  const issues = svc.issues.filter((x) => p.issueIds.includes(x.id)).map((x) => l(x.name));
  const extras = [p.voiceNote ? t('summary.voice') : null, p.photos.length > 0 ? `${t('summary.photos')} ${p.photos.length}` : null].filter(Boolean).join(' · ');
  const problemText = [issues.join(', '), p.voiceNote?.transcript ?? '', p.notes.trim()].filter((x) => x.length > 0).join(' · ') || extras;
  const time = draft.time;
  const addressId = draft.addressId;
  const slotTaken = isApiError(error, 'SLOT_UNAVAILABLE') || isApiError(error, 'INSTANT_UNAVAILABLE');

  const pay = async () => {
    setBusy(true);
    setError(null);
    try {
      let bookingId = created.current;
      if (bookingId) {
        const existing = await backend.bookings.get(session.token, bookingId);
        if (existing.status !== 'AWAITING_PAYMENT') bookingId = null;
      }
      if (!bookingId) {
        const input = { serviceId: svc.id, problem: p, addressId, time, preferWomenRated: draft.preferWomenRated, ...(draft.repeat ? { repeatOf: draft.repeat.bookingId } : {}) };
        const b = await backend.bookings.create(session.token, input, createKeys.keyFor(JSON.stringify(input)));
        createKeys.settle();
        // The customer left while the booking was being created: withdraw it at once, and stay where they went.
        if (!mounted.current) {
          void withdrawUnpaid(backend, session.token, b.id);
          return;
        }
        bookingId = b.id;
        created.current = b.id;
      }
      markPayIntent(bookingId);
      router.push({ pathname: '/pay', params: { id: bookingId, kind: 'VISIT', method: draft.method, auto: '1' } });
    } catch (e) {
      // Kept only when the booking may have been created anyway, so the retry returns that booking.
      if (!outcomeUnknown(e)) createKeys.settle();
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen
      testID="book-confirm"
      header={<StepHeader step={4} />}
      footer={
        <>
          {slotTaken ? (
            <View style={styles.stack}>
              <Banner tone="danger" text={t('review.slotTaken')} testID="slot-taken" />
              {isApiError(error) && error.simulated ? <Banner tone="demo" text={t('error.simulated')} /> : null}
              <Button label={t('review.chooseTime')} icon="calendar" variant="outline" size="md" testID="review-choose-time" onPress={() => {
                setError(null);
                router.navigate('/book/when');
              }} />
            </View>
          ) : <ErrorBanner error={error} />}
          <View style={styles.footer}>
            <View>
              <Txt variant="caption" color="inkMuted">{t('confirm.payNow')}</Txt>
              <Txt variant="title2">{formatRupees(svc.visitFee)}</Txt>
            </View>
            <Button label={t('confirm.pay', { amount: formatRupees(svc.visitFee) })} icon="lock-closed" onPress={() => void pay()} loading={busy} disabled={slotTaken} style={styles.flex} testID="review-confirm" />
          </View>
        </>
      }
    >
      <Txt variant="title1" heading>{t('confirm.title')}</Txt>

      <Card style={styles.card}>
        <View style={styles.svcRow}>
          {cat ? <CategoryBadge category={cat} serviceId={svc.id} size={52} /> : null}
          <Txt variant="bodyStrong" style={styles.flex}>{l(svc.name)}</Txt>
        </View>
        <Divider />
        <Row icon="construct-outline" label={t('review.problem')} onEdit={() => router.navigate('/book/problem')} testID="review-edit-problem">
          <Txt variant="callout" numberOfLines={3}>{problemText}</Txt>
        </Row>
        <Divider />
        <Row icon="location-outline" label={t('review.address')} onEdit={() => router.navigate('/book/address')} testID="review-edit-address">
          <Txt variant="callout">{address ? `${t(`address.label.${address.label}`)} · ${addressLine(address)}, ${address.city}` : '…'}</Txt>
        </Row>
        <Divider />
        <Row icon="calendar-outline" label={t('review.when')} onEdit={() => router.navigate('/book/when')} testID="review-edit-time">
          <Txt variant="callout" testID="review-when">{visitTimeText(time, locale, t)}</Txt>
        </Row>
      </Card>

      {draft.repeat ? <Banner tone="info" icon="person-circle-outline" text={t('confirm.repeat', { name: draft.repeat.name })} testID="confirm-repeat" /> : null}

      <Tap onPress={() => setPreferWomenRated(!draft.preferWomenRated)} style={[styles.pref, draft.preferWomenRated && styles.prefOn]} testID="pref-women"
        accessibilityRole="switch" accessibilityState={{ checked: draft.preferWomenRated }} accessibilityLabel={t('confirm.women')} scale={0.99}>
        <Art3D name="woman" size={52} />
        <View style={styles.flex}>
          <View style={styles.prefTitle}>
            <Txt variant="bodyStrong" style={styles.shrink}>{t('confirm.women')}</Txt>
            <Pill label={t('common.optional')} tone="neutral" />
          </View>
          <Txt variant="footnote" color="inkMuted">{t('confirm.womenSub')}</Txt>
        </View>
        <Switch value={draft.preferWomenRated} onValueChange={setPreferWomenRated} trackColor={{ true: colors.blue, false: colors.lineStrong }} thumbColor={colors.surface} />
      </Tap>

      <Card style={styles.card}>
        <View style={styles.priceHead}>
          <Txt variant="title3" heading style={styles.flex}>{t('review.price')}</Txt>
          {isDemo ? <Pill label={t('review.demoPrices')} tone="demo" icon="flask" /> : null}
        </View>
        <PriceLine label={t('confirm.visitFee')} value={formatRupees(svc.visitFee)} strong />
        <PriceLine label={t('confirm.repair')} value={t('confirm.repairValue', { min: formatRupees(QUOTE_MIN) })} muted />
        <View style={styles.notes}>
          <Good art="check" text={t('confirm.n1')} />
          <Good art="money" text={t('confirm.n2')} />
          <Good art="shield" text={t('confirm.n3')} />
        </View>
      </Card>

      <Card style={styles.card}>
        <Txt variant="title3" heading>{t('pay.method')}</Txt>
        {VISIT_METHODS.map((m) => (
          <Tap key={m.method} onPress={() => setMethod(m.method)} style={[styles.method, draft.method === m.method && styles.methodOn]} testID={`method-${m.method}`}
            accessibilityRole="radio" accessibilityState={{ selected: draft.method === m.method }} accessibilityLabel={t(`pay.m.${m.method}`)}>
            <View style={styles.methodIcon}><Icon name={m.icon} size={20} color="navy" /></View>
            <View style={styles.flex}>
              <Txt variant="bodyStrong">{t(`pay.m.${m.method}`)}</Txt>
              <Txt variant="footnote" color="inkMuted">{t(`pay.ms.${m.method}`)}</Txt>
            </View>
            <RadioDot on={draft.method === m.method} />
          </Tap>
        ))}
      </Card>

      {isDemo ? <Banner tone="demo" text={t('pay.demo')} /> : null}
    </Screen>
  );
}

function Row({ icon, label, onEdit, children, testID }: { readonly icon: IconName; readonly label: string; readonly onEdit: () => void; readonly children: ReactNode; readonly testID?: string }) {
  const { t } = useI18n();
  return (
    <View style={styles.row}>
      <View style={styles.rowIcon}><Icon name={icon} size={18} color="navy" /></View>
      <View style={styles.flexGap}>
        <Txt variant="caption" color="inkMuted">{label}</Txt>
        {children}
      </View>
      <Tap onPress={onEdit} style={styles.edit} accessibilityLabel={`${t('common.edit')} ${label}`} testID={testID}>
        <Txt variant="label" color="blue">{t('common.edit')}</Txt>
      </Tap>
    </View>
  );
}

function PriceLine({ label, value, muted, strong }: { readonly label: string; readonly value: string; readonly muted?: boolean; readonly strong?: boolean }) {
  return (
    <View style={styles.priceLine}>
      <Txt variant={strong ? 'bodyStrong' : 'callout'} style={styles.flex}>{label}</Txt>
      <Txt variant={strong ? 'title3' : 'callout'} color={muted ? 'inkMuted' : 'ink'} style={styles.priceValue}>{value}</Txt>
    </View>
  );
}

function Good({ art, text }: { readonly art: ArtName; readonly text: string }) {
  return (
    <View style={styles.good}>
      <Art3D name={art} size={26} />
      <Txt variant="footnote" style={styles.flex}>{text}</Txt>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  shrink: { flexShrink: 1 },
  flexGap: { flex: 1, gap: 2 },
  stack: { gap: space.sm },
  footer: { flexDirection: 'row', alignItems: 'center', gap: space.lg },
  card: { gap: space.md },
  svcRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: space.md },
  rowIcon: { width: 40, height: 40, borderRadius: radius.icon, backgroundColor: colors.blueTint, alignItems: 'center', justifyContent: 'center' },
  edit: { minHeight: 36, minWidth: 44, alignItems: 'flex-end', justifyContent: 'center' },
  pref: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.lg, borderRadius: radius.lg, backgroundColor: colors.surface, borderWidth: 1.5, borderColor: colors.line },
  prefOn: { borderColor: colors.blue, backgroundColor: '#FBFCFF' },
  prefTitle: { flexDirection: 'row', alignItems: 'center', gap: space.sm, flexWrap: 'wrap' },
  priceHead: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  priceLine: { flexDirection: 'row', alignItems: 'flex-start', gap: space.md },
  priceValue: { flexShrink: 1, maxWidth: '58%', textAlign: 'right' },
  notes: { gap: space.sm, paddingTop: space.xs },
  good: { flexDirection: 'row', gap: space.sm, alignItems: 'center' },
  method: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 60, paddingHorizontal: space.md, borderRadius: radius.md, borderWidth: 1.5, borderColor: colors.line },
  methodOn: { borderColor: colors.blue, backgroundColor: '#FBFCFF' },
  methodIcon: { width: 40, height: 40, borderRadius: radius.icon, backgroundColor: colors.blueTint, alignItems: 'center', justifyContent: 'center' },
});
