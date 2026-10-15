// Service details: what it covers, common issues, the visit fee and how pricing works, then Book now.
import { router, useLocalSearchParams } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { categoryById } from '../../data/catalog';
import { Mascot } from '../../illustrations/Mascot';
import { formatRupees } from '../../i18n/format';
import { useI18n } from '../../i18n/I18n';
import { useBackend, useQuery } from '../../services/ServicesProvider';
import { useDraft } from '../../state/BookingDraft';
import { colors, radius, space } from '../../theme/tokens';
import { Button, Card, ErrorView, Header, Icon, Pill, Screen, Skeleton, Txt, Wash } from '../../ui';

export default function ServiceDetails() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, l } = useI18n();
  const backend = useBackend();
  const draft = useDraft();
  const q = useQuery(() => backend.catalog.service(id), [backend, id]);
  const s = q.data;
  const cat = s ? categoryById(s.categoryId) : undefined;

  const book = () => {
    if (!s) return;
    draft.start(s.id);
    router.push('/book/issue');
  };

  return (
    <Screen
      testID="service-details"
      header={<Header />}
      wash={cat?.wash ?? 'sky'}
      footer={s ? (
        <View style={styles.footer}>
          <View>
            <Txt variant="caption" color="inkMuted">{t('service.visitFee')}</Txt>
            <Txt variant="title2" testID="service-fee">{formatRupees(s.visitFee)}</Txt>
          </View>
          <Button label={t('service.book')} onPress={book} style={styles.flex} testID="service-book" trailingIcon="arrow-forward" />
        </View>
      ) : undefined}
    >
      {q.loading ? <><Skeleton style={styles.skelHero} /><Skeleton style={styles.skelLine} /><Skeleton style={styles.skelLine} /></> : null}
      {q.error ? <ErrorView error={q.error} onRetry={q.reload} /> : null}
      {s ? (
        <>
          <Wash name={cat?.wash ?? 'sky'} style={styles.hero}>
            <Mascot pose="wrench" size={170} />
          </Wash>
          <View style={styles.titleBlock}>
            <Txt variant="title1" heading>{l(s.name)}</Txt>
            <View style={styles.meta}>
              <Icon name="star" size={16} color="yellow" />
              <Txt variant="label" color="inkMuted">{t('service.rating', { rating: s.rating.toFixed(1), count: s.reviews.toLocaleString('en-IN') })}</Txt>
            </View>
            <Txt variant="body" color="inkMuted">{l(s.description)}</Txt>
          </View>

          <View style={styles.block}>
            <Txt variant="title3" heading>{t('service.issues')}</Txt>
            <View style={styles.chips}>
              {s.issues.map((x) => <Pill key={x.id} label={l(x.name)} tone="info" />)}
            </View>
          </View>

          <Card style={styles.block}>
            <Txt variant="title3" heading>{t('service.included')}</Txt>
            {(['service.inc1', 'service.inc2', 'service.inc3'] as const).map((k) => (
              <View key={k} style={styles.inc}>
                <Icon name="checkmark-circle" size={20} color="success" />
                <Txt variant="callout" style={styles.flex}>{t(k)}</Txt>
              </View>
            ))}
            <View style={styles.inc}>
              <Icon name="time-outline" size={20} color="inkMuted" />
              <Txt variant="callout" color="inkMuted" style={styles.flex}>{t('service.duration', { min: s.durationMin[0], max: s.durationMin[1] })}</Txt>
            </View>
          </Card>

          <Card style={[styles.block, styles.feeCard]}>
            <View style={styles.feeRow}>
              <Txt variant="bodyStrong" style={styles.flex}>{t('service.visitFee')}</Txt>
              <Txt variant="price">{formatRupees(s.visitFee)}</Txt>
            </View>
            <Txt variant="footnote" color="inkMuted">{t('service.visitFeeNote')}</Txt>
            <Pill label={t('review.demoPrices')} tone="demo" icon="flask" />
          </Card>
        </>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  footer: { flexDirection: 'row', alignItems: 'center', gap: space.lg },
  skelHero: { height: 220, borderRadius: radius.xxl },
  skelLine: { height: 24, borderRadius: radius.sm },
  hero: { height: 220, borderRadius: radius.xxl, alignItems: 'center', justifyContent: 'flex-end', overflow: 'hidden' },
  titleBlock: { gap: space.xs },
  meta: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  block: { gap: space.md },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  inc: { flexDirection: 'row', gap: space.md, alignItems: 'center' },
  feeCard: { borderColor: colors.blueTint, backgroundColor: '#FBFCFF' },
  feeRow: { flexDirection: 'row', alignItems: 'center' },
});
