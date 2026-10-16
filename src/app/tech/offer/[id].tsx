// A new job offer: what the problem is, where (area only until accepted), when, how far, and the visit earning, with a
// countdown. Rings and vibrates until answered. Accept opens the job; Reject (with an optional reason) goes back.
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { categoryById, serviceById } from '../../../data/catalog';
import type { JobOffer, OfferRejectReason } from '../../../domain/types';
import { Art3D, serviceArt } from '../../../illustrations/Art3D';
import { formatRupees } from '../../../i18n/format';
import { useI18n } from '../../../i18n/I18n';
import { isApiError } from '../../../services/api';
import { feedback, stopCue } from '../../../services/feedback';
import { useBackend } from '../../../services/ServicesProvider';
import { useTechSession } from '../../../state/AppState';
import { colors, radius, space } from '../../../theme/tokens';
import { Banner, Button, Card, Chip, ConfirmSheet, ErrorBanner, Header, Pill, Screen, Skeleton, Txt } from '../../../ui';
import { Appear, useReducedMotion } from '../../../ui/motion';
import { visitTimeText } from '../../../ui/present';
import { InfoRow } from '../../../ui/TechParts';

const REASONS: readonly OfferRejectReason[] = ['TOO_FAR', 'BUSY', 'NOT_MY_SKILL', 'OTHER'];
const RING = 76;
const STROKE = 8;

export default function OfferScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, l, locale } = useI18n();
  const backend = useBackend();
  const session = useTechSession();
  const [offer, setOffer] = useState<JobOffer | null | undefined>(undefined);
  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState<OfferRejectReason | null>(null);
  const [expired, setExpired] = useState(false);
  // Reduced motion: a calmer countdown that changes every 5 s instead of every second.
  const reduce = useReducedMotion();

  useEffect(() => {
    let alive = true;
    void backend.tech.offer(session.token).then((o) => {
      if (alive) setOffer(o && o.id === id ? o : null);
    }).catch(() => {
      if (alive) setOffer(null);
    });
    return () => {
      alive = false;
    };
  }, [backend, session.token, id]);

  const left = offer ? Math.max(0, Math.ceil((offer.expiresAt - now) / 1000)) : 0;
  const total = offer ? Math.max(1, Math.round((offer.expiresAt - offer.createdAt) / 1000)) : 1;
  const open = !!offer && left > 0 && !expired;

  useEffect(() => {
    if (!open) return;
    const tick = setInterval(() => setNow(Date.now()), reduce ? 5000 : 1000);
    // Keep ringing every few seconds until answered.
    const ring = setInterval(() => feedback('offer'), 6000);
    return () => {
      clearInterval(tick);
      clearInterval(ring);
      stopCue('offer');
    };
  }, [open, reduce]);

  useEffect(() => {
    if (offer && left === 0 && !expired) {
      setExpired(true);
      feedback('warning');
    }
  }, [offer, left, expired]);

  const accept = async () => {
    if (!offer) return;
    setBusy(true);
    setError(null);
    stopCue('offer');
    try {
      const job = await backend.tech.acceptOffer(session.token, offer.id);
      feedback('success');
      router.replace(`/tech/job/${job.id}`);
    } catch (e) {
      if (isApiError(e, 'OFFER_EXPIRED')) setExpired(true);
      feedback('error');
      setError(isApiError(e, 'OFFER_EXPIRED') ? null : e);
    } finally {
      setBusy(false);
    }
  };

  const reject = async () => {
    if (!offer) return;
    setRejecting(false);
    stopCue('offer');
    await backend.tech.rejectOffer(session.token, offer.id, reason).catch(() => undefined);
    feedback('pop');
    router.back();
  };

  const svc = offer ? serviceById(offer.serviceId) : undefined;
  const cat = offer ? categoryById(offer.categoryId) : undefined;
  const issues = svc && offer ? svc.issues.filter((x) => offer.issueIds.includes(x.id)).map((x) => l(x.name)) : [];
  const r = (RING - STROKE) / 2;
  const c = 2 * Math.PI * r;

  return (
    <Screen
      testID="tech-offer"
      wash={open ? 'sunrise' : 'sky'}
      header={<Header title={t('toffer.title')} back={!open} />}
      footer={open ? (
        <View style={styles.footer}>
          <Button label={t('toffer.reject')} variant="outline" onPress={() => setRejecting(true)} disabled={busy} style={styles.flex} testID="offer-reject" />
          <Button label={t('toffer.accept')} icon="checkmark-circle" variant="success" onPress={() => void accept()} loading={busy} style={styles.flex2} testID="offer-accept" />
        </View>
      ) : offer !== undefined ? <Button label={t('toffer.back')} variant="outline" onPress={() => router.back()} testID="offer-back" /> : undefined}
    >
      {offer === undefined ? <Skeleton style={styles.skel} /> : null}
      {offer !== undefined && !open ? (
        <View style={styles.expired} testID="offer-expired">
          <Art3D name="job_offer" size={120} float shadow />
          <Txt variant="title1" align="center" heading>{t('toffer.expired')}</Txt>
          <Txt variant="body" color="inkMuted" align="center">{t('toffer.expiredBody')}</Txt>
        </View>
      ) : null}
      {offer && open ? (
        <>
          <Appear style={styles.top}>
            <View style={styles.flex}>
              <Pill label={t('toffer.new')} tone="warning" icon="flash" />
              <Txt variant="title1" heading>{svc ? l(svc.name) : ''}</Txt>
              <Txt variant="callout" color="inkMuted">{cat ? l(cat.name) : ''} · {offer.code}</Txt>
            </View>
            <View style={styles.ring} accessibilityLabel={t('toffer.secondsLeft', { n: left })} testID="offer-countdown">
              <Svg width={RING} height={RING}>
                <Circle cx={RING / 2} cy={RING / 2} r={r} stroke={colors.line} strokeWidth={STROKE} fill="none" />
                <Circle cx={RING / 2} cy={RING / 2} r={r} stroke={left <= 10 ? colors.danger : colors.blue} strokeWidth={STROKE} fill="none" strokeLinecap="round"
                  strokeDasharray={`${c} ${c}`} strokeDashoffset={c * (1 - left / total)} transform={`rotate(-90 ${RING / 2} ${RING / 2})`} />
              </Svg>
              <View style={styles.ringText}><Txt variant="title2" color={left <= 10 ? 'danger' : 'navy'}>{left}</Txt></View>
            </View>
          </Appear>

          <View style={styles.earnBox} testID="offer-earning">
            <Art3D name="earnings" size={52} />
            <View style={styles.flex}>
              <Txt variant="caption" color="onNavy" style={styles.dim}>{t('toffer.earn')}</Txt>
              <Txt variant="title2" color="onNavy">{t('toffer.earnValue', { amount: formatRupees(offer.visitEarning) })}</Txt>
            </View>
          </View>

          <Card style={styles.details}>
            {cat ? <View style={styles.catArt}><Art3D name={serviceArt(offer?.serviceId, cat.art)} size={72} float /></View> : null}
            {issues.length > 0 ? <View style={styles.chips}>{issues.map((x) => <Pill key={x} label={x} tone="info" icon="construct" />)}</View> : null}
            {offer.notes ? <Txt variant="callout">“{offer.notes}”</Txt> : null}
            {offer.photoCount > 0 ? <Txt variant="footnote" color="inkMuted">{t('toffer.photos', { n: offer.photoCount })}</Txt> : null}
            <InfoRow icon="location" label={t('toffer.area')} value={`${offer.area} · ${offer.pincode}`} />
            <InfoRow icon="navigate" label={t('toffer.distance')} value={t('toffer.km', { km: offer.distanceKm.toFixed(1) })} />
            <InfoRow icon="time" label={t('toffer.when')} value={visitTimeText(offer.time, locale, t)} />
          </Card>
          <Banner tone="info" icon="lock-closed" text={t('toffer.private')} />
          <ErrorBanner error={error} />
        </>
      ) : null}

      <ConfirmSheet visible={rejecting} title={t('toffer.rejectTitle')} body={t('toffer.rejectBody')} icon="close-circle" confirmLabel={t('toffer.reject')} confirmVariant="danger"
        cancelLabel={t('common.back')} onConfirm={() => void reject()} onCancel={() => setRejecting(false)}>
        <View style={styles.chips}>
          {REASONS.map((x) => <Chip key={x} label={t(`toffer.r.${x}`)} selected={reason === x} onPress={() => setReason(reason === x ? null : x)} testID={`offer-reason-${x}`} />)}
        </View>
      </ConfirmSheet>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  flex2: { flex: 2 },
  dim: { opacity: 0.85 },
  footer: { flexDirection: 'row', gap: space.md },
  skel: { height: 300, borderRadius: radius.xl },
  expired: { alignItems: 'center', gap: space.md, paddingTop: space.xl },
  top: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  ring: { width: RING, height: RING },
  ringText: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
  earnBox: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.lg, borderRadius: radius.xl, backgroundColor: '#11845A' },
  details: { gap: space.md },
  catArt: { alignItems: 'center' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
});
