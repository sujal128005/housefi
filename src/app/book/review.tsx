// Step 5: everything in one place, the visit fee and conditions, then submit.
import { Redirect, router } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { ActivityIndicator, Modal, StyleSheet, View } from 'react-native';
import { categoryById, serviceById } from '../../data/catalog';
import { SearchArt } from '../../illustrations/Scenes';
import { formatDuration, formatRupees } from '../../i18n/format';
import { useI18n } from '../../i18n/I18n';
import { isApiError } from '../../services/api';
import { useBackend, useQuery } from '../../services/ServicesProvider';
import { useSession } from '../../state/AppState';
import { useDraft } from '../../state/BookingDraft';
import { colors, radius, space } from '../../theme/tokens';
import { Banner, Button, Card, Divider, ErrorBanner, Icon, Pill, Screen, Tap, Txt, type IconName } from '../../ui';
import { CategoryBadge } from '../../ui/CategoryTile';
import { addressLine, whenText } from '../../ui/present';
import { StepHeader } from '../../ui/StepHeader';

export default function ReviewStep() {
  const { t, l, locale } = useI18n();
  const backend = useBackend();
  const session = useSession();
  const { draft, setWindow } = useDraft();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const addresses = useQuery(() => backend.addresses.list(session.token), [backend, session.token]);
  const svc = draft.serviceId ? serviceById(draft.serviceId) : undefined;
  if (!svc || !draft.window || !draft.addressId) return <Redirect href="/home" />;
  const cat = categoryById(svc.categoryId);
  const address = addresses.data?.find((a) => a.id === draft.addressId);
  const p = draft.problem;
  const issues = svc.issues.filter((x) => p.issueIds.includes(x.id)).map((x) => l(x.name));
  const extras = [
    p.voiceNote ? `${t('summary.voice')} ${formatDuration(p.voiceNote.durationSec)}` : null,
    p.photos.length > 0 ? `${t('summary.photos')} ${p.photos.length}` : null,
  ].filter(Boolean);
  const problemText = [issues.join(', '), p.notes.trim()].filter((x) => x.length > 0).join(' · ') || extras.join(' · ');
  const window = draft.window;
  const addressId = draft.addressId;
  const slotTaken = isApiError(error, 'SLOT_UNAVAILABLE');

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const b = await backend.bookings.create(session.token, { serviceId: svc.id, problem: p, addressId, window });
      // The draft is cleared by the confirmation screen, after these steps have left the stack.
      if (router.canDismiss()) router.dismissAll();
      router.push({ pathname: '/book/confirmed', params: { id: b.id } });
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen
      testID="book-review"
      header={<StepHeader step={5} />}
      footer={
        <>
          {slotTaken ? (
            <View style={styles.slotTaken}>
              <Banner tone="danger" text={t('review.slotTaken')} testID="slot-taken" />
              {isApiError(error) && error.simulated ? <Banner tone="demo" text={t('error.simulated')} /> : null}
              <Button label={t('review.chooseTime')} icon="calendar" variant="outline" size="md" testID="review-choose-time" onPress={() => {
                setWindow(null);
                setError(null);
                router.navigate('/book/schedule');
              }} />
            </View>
          ) : <ErrorBanner error={error} />}
        <View style={styles.footer}>
          <View>
            <Txt variant="caption" color="inkMuted">{t('review.payLater')}</Txt>
            <Txt variant="title2">{formatRupees(svc.visitFee)}</Txt>
          </View>
          <Button label={t('review.confirm')} onPress={() => void submit()} loading={busy} disabled={slotTaken} style={styles.flex} testID="review-confirm" />
        </View>
        </>
      }
    >
      <Txt variant="title1" heading>{t('review.title')}</Txt>

      <Card style={styles.card}>
        <View style={styles.svcRow}>
          {cat ? <CategoryBadge category={cat} size={48} /> : null}
          <Txt variant="bodyStrong" style={styles.flex}>{l(svc.name)}</Txt>
        </View>
        <Divider />
        <Row icon="construct-outline" label={t('review.problem')} onEdit={() => router.navigate('/book/summary')} testID="review-edit-problem">
          <Txt variant="callout" numberOfLines={3}>{problemText}</Txt>
          {extras.length > 0 && problemText !== extras.join(' · ') ? <Txt variant="footnote" color="inkMuted">{extras.join(' · ')}</Txt> : null}
        </Row>
        <Divider />
        <Row icon="location-outline" label={t('review.address')} onEdit={() => router.navigate('/book/address')} testID="review-edit-address">
          <Txt variant="callout">{address ? `${t(`address.label.${address.label}`)} · ${addressLine(address)}` : '…'}</Txt>
        </Row>
        <Divider />
        <Row icon="calendar-outline" label={t('review.when')} onEdit={() => router.navigate('/book/schedule')} testID="review-edit-time">
          <Txt variant="callout" testID="review-when">{whenText(window, locale, t)}</Txt>
        </Row>
      </Card>

      <Card style={styles.card}>
        <View style={styles.priceHead}>
          <Txt variant="title3" heading style={styles.flex}>{t('review.price')}</Txt>
          <Pill label={t('review.demoPrices')} tone="demo" icon="flask" />
        </View>
        <PriceLine label={t('review.visitFee')} value={formatRupees(svc.visitFee)} />
        <PriceLine label={t('review.repair')} value={t('review.repairValue')} muted />
        <Divider />
        <PriceLine label={t('review.payNow')} value={formatRupees(0)} />
        <PriceLine label={t('review.payLater')} value={formatRupees(svc.visitFee)} strong />
      </Card>

      <Card style={[styles.card, styles.goodCard]}>
        <Txt variant="title3" heading>{t('review.goodToKnow')}</Txt>
        <Good icon="wallet-outline" text={t('review.c1')} />
        <Good icon="hand-left-outline" text={t('review.c2')} />
        <Good icon="swap-horizontal-outline" text={t('review.c3')} />
        <Good icon="close-circle-outline" text={t('review.c4')} />
      </Card>


      <Modal visible={busy} transparent animationType="fade" statusBarTranslucent>
        <View style={styles.overlay}>
          <View style={styles.overlayCard}>
            <SearchArt size={160} />
            <ActivityIndicator color={colors.navy} />
            <Txt variant="bodyStrong" align="center">{t('review.submitting')}</Txt>
          </View>
        </View>
      </Modal>
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
      <Txt variant={strong ? 'title3' : 'callout'} color={muted ? 'inkMuted' : 'ink'}>{value}</Txt>
    </View>
  );
}

function Good({ icon, text }: { readonly icon: IconName; readonly text: string }) {
  return (
    <View style={styles.good}>
      <Icon name={icon} size={20} color="blue" />
      <Txt variant="callout" style={styles.flex}>{text}</Txt>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  flexGap: { flex: 1, gap: 2 },
  footer: { flexDirection: 'row', alignItems: 'center', gap: space.lg },
  card: { gap: space.md },
  svcRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: space.md },
  rowIcon: { width: 36, height: 36, borderRadius: 12, backgroundColor: colors.blueTint, alignItems: 'center', justifyContent: 'center' },
  edit: { minHeight: 36, minWidth: 44, alignItems: 'flex-end', justifyContent: 'center' },
  priceHead: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  priceLine: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  goodCard: { backgroundColor: '#FBFCFF' },
  good: { flexDirection: 'row', gap: space.md, alignItems: 'flex-start' },
  slotTaken: { gap: space.sm },
  overlay: { flex: 1, backgroundColor: colors.overlay, alignItems: 'center', justifyContent: 'center', padding: space.xl },
  overlayCard: { backgroundColor: colors.surface, borderRadius: radius.xxl, padding: space.xl, alignItems: 'center', gap: space.md, width: '100%', maxWidth: 340 },
});
