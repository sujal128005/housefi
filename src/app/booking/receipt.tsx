// Receipt for a finished (or cancelled) booking: what was paid, how, and any refund. Demo receipt, not a tax invoice.
import { useLocalSearchParams } from 'expo-router';
import { Share, StyleSheet, View } from 'react-native';
import { serviceById } from '../../data/catalog';
import { finalAmount } from '../../domain/rules';
import type { Payment } from '../../domain/types';
import { Art3D } from '../../illustrations/Art3D';
import { formatDate, formatRupees } from '../../i18n/format';
import { useI18n } from '../../i18n/I18n';
import { useBackend, useQuery } from '../../services/ServicesProvider';
import { useSession } from '../../state/AppState';
import { colors, radius, space } from '../../theme/tokens';
import { Banner, Button, Card, Divider, ErrorView, Header, Screen, Skeleton, Txt, useToast } from '../../ui';
import { QuoteLines } from '../../ui/BookingParts';
import { Pop } from '../../ui/motion';
import { addressLine } from '../../ui/present';

export default function Receipt() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, l, locale } = useI18n();
  const backend = useBackend();
  const session = useSession();
  const toast = useToast();
  const q = useQuery(() => backend.bookings.get(session.token, id), [backend, session.token, id]);
  const b = q.data;
  const svc = b ? serviceById(b.serviceId) : undefined;

  const payLine = (p: Payment, label: string) => (
    <View style={styles.payBlock}>
      <View style={styles.line}>
        <Txt variant="callout" style={styles.flex}>{label}</Txt>
        <Txt variant="label">{formatRupees(p.amount)}</Txt>
      </View>
      <Txt variant="footnote" color={p.state === 'REFUNDED' ? 'success' : 'inkMuted'}>
        {t(`pay.state.${p.state}`)}{p.method ? ` · ${t(`pay.m.${p.method}`)}` : ''}{p.txnId ? ` · ${p.txnId}` : ''}
      </Txt>
    </View>
  );

  const paidTotal = b ? (b.visitPayment.state === 'PAID' ? b.visitPayment.amount : 0) + (b.finalPayment?.state === 'PAID' ? b.finalPayment.amount : 0) : 0;

  const share = async () => {
    if (!b) return;
    try {
      await Share.share({ message: t('receipt.shareText', { code: b.code, amount: formatRupees(paidTotal) }) });
    } catch {
      toast.show(t('safety.shareFailed'), 'share-social');
    }
  };

  return (
    <Screen testID="receipt" wash="mint" header={<Header title={t('receipt.title')} />}
      footer={b ? <Button label={t('receipt.share')} icon="share-social" variant="outline" onPress={() => void share()} testID="receipt-share" /> : undefined}>
      {q.loading ? <Skeleton style={styles.skel} /> : null}
      {q.error ? <ErrorView error={q.error} onRetry={q.reload} /> : null}
      {b ? (
        <>
          <View style={styles.head}>
            <Pop><Art3D name="receipt" size={90} shadow /></Pop>
            <Txt variant="caption" color="inkMuted">{t('receipt.totalPaid')}</Txt>
            <Txt variant="hero" testID="receipt-total">{formatRupees(paidTotal)}</Txt>
          </View>
          <Card style={styles.card}>
            <View style={styles.line}>
              <Txt variant="footnote" color="inkMuted" style={styles.flex}>{t('confirmed.id')}</Txt>
              <Txt variant="label" selectable>{b.code}</Txt>
            </View>
            <View style={styles.line}>
              <Txt variant="footnote" color="inkMuted" style={styles.flex}>{t('receipt.date')}</Txt>
              <Txt variant="label">{formatDate(new Date(b.createdAt), locale)}</Txt>
            </View>
            <Txt variant="bodyStrong">{svc ? l(svc.name) : ''}</Txt>
            {b.technician ? <Txt variant="footnote" color="inkMuted">{t('receipt.by', { name: l(b.technician.name) })}</Txt> : null}
            <Txt variant="footnote" color="inkMuted">{addressLine(b.address)}, {b.address.city}</Txt>
            <Divider />
            {payLine(b.visitPayment, t('confirm.visitFee'))}
            {b.quote?.decision === 'APPROVED' ? <QuoteLines quote={b.quote} /> : null}
            {b.extraQuote?.decision === 'APPROVED' ? <QuoteLines quote={b.extraQuote} /> : null}
            {b.finalPayment ? payLine({ ...b.finalPayment, amount: finalAmount(b.quote, b.extraQuote) }, t('receipt.repairPayment')) : null}
            <Divider />
            <View style={styles.line}>
              <Txt variant="bodyStrong" style={styles.flex}>{t('receipt.totalPaid')}</Txt>
              <Txt variant="title2">{formatRupees(paidTotal)}</Txt>
            </View>
          </Card>
          <Banner tone="demo" text={t('receipt.demo')} />
        </>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  skel: { height: 240, borderRadius: radius.lg },
  head: { alignItems: 'center', gap: 2 },
  card: { gap: space.sm, borderColor: colors.successTint },
  line: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  payBlock: { gap: 2 },
});
