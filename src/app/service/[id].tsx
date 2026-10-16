// Service details: what it covers, common issues, the ₹49 visit fee and the repair price range, then Book now.
import { router, useLocalSearchParams } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { categoryById } from '../../data/catalog';
import { Art3D } from '../../illustrations/Art3D';
import { formatRupees } from '../../i18n/format';
import { useI18n } from '../../i18n/I18n';
import { useBackend, useQuery } from '../../services/ServicesProvider';
import { useDraft } from '../../state/BookingDraft';
import { colors, radius, space } from '../../theme/tokens';
import { Button, Card, Chip, ErrorView, Header, Icon, Pill, Screen, Skeleton, Txt, Wash } from '../../ui';
import { Appear } from '../../ui/motion';

export default function ServiceDetails() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, l } = useI18n();
  const backend = useBackend();
  const draft = useDraft();
  const q = useQuery(() => backend.catalog.service(id), [backend, id]);
  const s = q.data;
  const cat = s ? categoryById(s.categoryId) : undefined;

  const book = (issueId?: string) => {
    if (!s) return;
    draft.start(s.id, issueId);
    router.push('/book/problem');
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
          <Button label={t('service.book')} onPress={() => book()} style={styles.flex} testID="service-book" trailingIcon="arrow-forward" />
        </View>
      ) : undefined}
    >
      {q.loading ? <><Skeleton style={styles.skelHero} /><Skeleton style={styles.skelLine} /><Skeleton style={styles.skelLine} /></> : null}
      {q.error ? <ErrorView error={q.error} onRetry={q.reload} /> : null}
      {s ? (
        <>
          <Wash name={cat?.wash ?? 'sky'} style={styles.hero}>
            <Art3D name="tech_man" size={150} float shadow />
            {cat ? <Art3D name={cat.art} size={86} style={styles.heroObj} /> : null}
          </Wash>
          <Appear style={styles.titleBlock}>
            <Txt variant="title1" heading>{l(s.name)}</Txt>
            <View style={styles.meta}>
              <Icon name="star" size={16} color="yellow" />
              <Txt variant="label" color="inkMuted">{t('service.rating', { rating: s.rating.toFixed(1), count: s.reviews.toLocaleString('en-IN') })}</Txt>
            </View>
            <Txt variant="body" color="inkMuted">{l(s.description)}</Txt>
          </Appear>

          <View style={styles.block}>
            <Txt variant="title3" heading>{t('service.issues')}</Txt>
            <View style={styles.chips}>
              {s.issues.map((x) => <Chip key={x.id} label={l(x.name)} selected={false} icon="add-circle-outline" onPress={() => book(x.id)} testID={`svc-issue-${x.id}`} />)}
            </View>
          </View>

          <Card style={[styles.block, styles.feeCard]}>
            <View style={styles.feeRow}>
              <View style={styles.flex}>
                <Txt variant="bodyStrong">{t('service.visitFee')}</Txt>
                <Txt variant="footnote" color="inkMuted">{t('service.visitFeeNote')}</Txt>
              </View>
              <Txt variant="price">{formatRupees(s.visitFee)}</Txt>
            </View>
            <View style={styles.feeRow}>
              <Txt variant="callout" style={styles.flex}>{t('confirm.repair')}</Txt>
              <Txt variant="bodyStrong" color="blue">{t('confirm.repairShort')}</Txt>
            </View>
            <Pill label={t('review.demoPrices')} tone="demo" icon="flask" />
          </Card>

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
        </>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  footer: { flexDirection: 'row', alignItems: 'center', gap: space.lg },
  skelHero: { height: 200, borderRadius: radius.xxl },
  skelLine: { height: 24, borderRadius: radius.sm },
  hero: { height: 200, borderRadius: radius.xxl, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  heroObj: { position: 'absolute', right: space.xl, bottom: space.lg },
  titleBlock: { gap: space.xs },
  meta: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  block: { gap: space.md },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  inc: { flexDirection: 'row', gap: space.md, alignItems: 'center' },
  feeCard: { borderColor: colors.blueTint, backgroundColor: '#FBFCFF' },
  feeRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
});
