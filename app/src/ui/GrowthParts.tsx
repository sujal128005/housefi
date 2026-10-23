// Booking extras: a coupon on the final bill, the 15-day "Not fixed? Free revisit" warranty, and the invoice PDF.
import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';
import type { Booking } from '../domain/types';
import { Art3D } from '../illustrations/Art3D';
import { formatDate, formatRupees } from '../i18n/format';
import { useI18n } from '../i18n/I18n';
import { isApiError } from '../services/api';
import { feedback } from '../services/feedback';
import { openWeb } from '../services/links';
import { useBackend } from '../services/ServicesProvider';
import { useSession } from '../state/AppState';
import { useNow } from '../state/useNow';
import { fontFamily } from '../theme/fonts';
import { colors, radius, space } from '../theme/tokens';
import { Button } from './Button';
import { Icon } from './Icon';
import { ConfirmSheet, Sheet, useToast } from './Overlays';
import { Banner, Card } from './Surfaces';
import { Tap } from './Tap';
import { Txt } from './Txt';
import { Field } from './Field';
import { useSingleFlight } from './useSingleFlight';

/** "Have a coupon?" on the bill while it can still change (no payment started). */
export function CouponBox({ booking, onChanged }: { readonly booking: Booking; readonly onChanged: (b: Booking) => void }) {
  const { t, locale } = useI18n();
  const backend = useBackend();
  const session = useSession();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  // The Done key and the Apply button: one check at a time.
  const once = useSingleFlight();
  const fp = booking.finalPayment;
  if (!fp || fp.state === 'PAID' || fp.state === 'PENDING' || fp.state === 'REFUNDED') return null;
  const applied = (fp.discount ?? 0) > 0 && fp.couponCode;

  const apply = () => once(async () => {
    if (!code.trim()) return;
    setBusy(true);
    setProblem(null);
    try {
      const r = await backend.bookings.applyCoupon(session.token, booking.id, code);
      if (r.applied) {
        feedback('success');
        setCode('');
        onChanged(r.booking);
      } else {
        feedback('warning');
        setProblem(t(`coupon.p.${r.problem ?? 'UNKNOWN'}`));
      }
    } catch {
      feedback('error');
      setProblem(t('coupon.failed'));
    } finally {
      setBusy(false);
    }
  });
  const remove = async () => {
    setBusy(true);
    try {
      onChanged(await backend.bookings.removeCoupon(session.token, booking.id));
    } catch {
      setProblem(t('coupon.failed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card style={styles.coupon} testID="coupon-box">
      {applied ? (
        <View style={styles.row}>
          <Icon name="pricetag" size={20} color="success" />
          <Txt variant="bodyStrong" color="success" style={styles.flex} testID="coupon-applied">{t('coupon.applied', { code: fp.couponCode ?? '', amount: formatRupees(fp.discount ?? 0) })}</Txt>
          <Button label={t('coupon.remove')} size="sm" variant="outline" onPress={() => void remove()} disabled={busy} testID="coupon-remove" />
        </View>
      ) : (
        <>
          <Txt variant="label" color="inkMuted">{t('coupon.title')}</Txt>
          <View style={styles.row}>
            <TextInput value={code} onChangeText={(v) => setCode(v.toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 20))} placeholder={t('coupon.placeholder')}
              placeholderTextColor={colors.inkSubtle} autoCapitalize="characters" autoCorrect={false} onSubmitEditing={() => void apply()} returnKeyType="done"
              style={[styles.input, { fontFamily: fontFamily('semibold', locale) }]} accessibilityLabel={t('coupon.placeholder')} testID="coupon-input" />
            <Button label={t('coupon.apply')} size="md" onPress={() => void apply()} loading={busy} disabled={!code.trim()} testID="coupon-apply" />
          </View>
          {problem ? <Txt variant="footnote" color="danger" testID="coupon-problem">{problem}</Txt> : null}
        </>
      )}
    </Card>
  );
}

/** On a completed job: "Not fixed? Free revisit" within 15 days, or the revisit already booked. */
export function WarrantyCard({ booking }: { readonly booking: Booking }) {
  const { t, locale } = useI18n();
  const backend = useBackend();
  const session = useSession();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  // Refreshes exactly when the warranty ends, so the button goes away on time.
  const now = useNow(booking.warrantyUntil ?? null);
  if (booking.warrantyClaim) {
    const claim = booking.warrantyClaim;
    return (
      <Tap onPress={() => router.push(`/booking/${claim.id}`)} style={styles.claim} accessibilityLabel={t('warranty.booked', { code: claim.code })} testID="warranty-claim">
        <Icon name="shield-checkmark" size={22} color="success" />
        <Txt variant="bodyStrong" style={styles.flex}>{t('warranty.booked', { code: claim.code })}</Txt>
        <Icon name="chevron-forward" size={18} color="inkSubtle" />
      </Tap>
    );
  }
  if (!booking.warrantyUntil || booking.warrantyUntil < now) return null;

  const claim = async () => {
    setBusy(true);
    try {
      const revisit = await backend.bookings.claimWarranty(session.token, booking.id, note.trim());
      feedback('success');
      setOpen(false);
      router.push(`/booking/${revisit.id}`);
    } catch (e) {
      feedback('error');
      toast.show(isApiError(e) && e.code === 'INSTANT_UNAVAILABLE' ? t('warranty.closedHours') : t('warranty.failed'), 'alert-circle');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Card style={styles.warranty} testID="warranty-card">
        <View style={styles.row}>
          <Art3D name="toolbox" size={48} />
          <View style={styles.flex}>
            <Txt variant="bodyStrong">{t('warranty.title')}</Txt>
            <Txt variant="footnote" color="inkMuted">{t('warranty.body', { date: formatDate(new Date(booking.warrantyUntil), locale) })}</Txt>
          </View>
        </View>
        <Button label={t('warranty.ask')} icon="refresh" variant="secondary" size="md" onPress={() => setOpen(true)} testID="warranty-ask" />
      </Card>
      <Sheet visible={open} onClose={() => setOpen(false)} testID="warranty-sheet">
        <Txt variant="title2" heading>{t('warranty.sheetTitle')}</Txt>
        <Txt variant="callout" color="inkMuted">{t('warranty.sheetBody')}</Txt>
        <Field label={t('warranty.note')} optional value={note} onChangeText={setNote} maxLength={400} multiline testID="warranty-note" />
        <Button label={t('warranty.confirm')} icon="shield-checkmark" onPress={() => void claim()} loading={busy} testID="warranty-confirm" />
      </Sheet>
    </>
  );
}

/** On a revisit: says it is free. */
export function WarrantyBanner({ booking }: { readonly booking: Booking }) {
  const { t } = useI18n();
  if (!booking.warrantyOf) return null;
  return <Banner tone="success" icon="shield-checkmark" text={t('warranty.isRevisit', { code: booking.warrantyOf })} testID="warranty-banner" />;
}

/** Opens the invoice PDF in the phone's browser (save or share it from there). */
export function InvoiceButton({ booking }: { readonly booking: Booking }) {
  const { t } = useI18n();
  const backend = useBackend();
  const session = useSession();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  if (booking.status !== 'COMPLETED' && booking.status !== 'CLOSED_NO_REPAIR') return null;
  const open = async () => {
    setBusy(true);
    try {
      openWeb(await backend.bookings.invoiceLink(session.token, booking.id));
    } catch {
      toast.show(t('invoice.failed'), 'alert-circle');
    } finally {
      setBusy(false);
    }
  };
  return <Button label={t('invoice.download')} icon="document-text-outline" variant="secondary" onPress={() => void open()} loading={busy} testID="invoice-download" />;
}

/** "Fixed, no charge" for the technician on a warranty revisit (after the start code). */
export function WarrantyFixedButton({ visible, onConfirm, busy }: { readonly visible: boolean; readonly onConfirm: () => void; readonly busy: boolean }) {
  const { t } = useI18n();
  const [ask, setAsk] = useState(false);
  if (!visible) return null;
  return (
    <>
      <Button label={t('tj.warrantyFixed')} icon="shield-checkmark" variant="secondary" onPress={() => setAsk(true)} testID="tj-warranty-fixed" />
      <ConfirmSheet visible={ask} title={t('tj.warrantyFixedTitle')} body={t('tj.warrantyFixedBody')} icon="shield-checkmark" confirmLabel={t('tj.warrantyFixed')}
        cancelLabel={t('common.back')} onConfirm={() => {
          setAsk(false);
          onConfirm();
        }} onCancel={() => setAsk(false)} busy={busy} />
    </>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  coupon: { gap: space.sm },
  input: { flex: 1, minHeight: 48, borderRadius: radius.md, borderWidth: 1.5, borderColor: colors.line, paddingHorizontal: space.md, color: colors.ink, fontSize: 16, backgroundColor: colors.surface, letterSpacing: 1 },
  warranty: { gap: space.md, borderColor: colors.successTint },
  claim: { flexDirection: 'row', alignItems: 'center', gap: space.sm, padding: space.md, borderRadius: radius.lg, backgroundColor: colors.successTint },
});
