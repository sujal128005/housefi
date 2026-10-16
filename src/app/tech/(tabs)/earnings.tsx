// Technician earnings: today, total, waiting for payout and the next weekly payout date, then every job's earning.
// Explains how earnings work: visit share, labour share, materials reimbursed.
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { serviceById } from '../../../data/catalog';
import { parseIsoDate, TECH_LABOUR_SHARE, TECH_VISIT_SHARE } from '../../../domain/rules';
import type { Earnings } from '../../../domain/types';
import { Art3D } from '../../../illustrations/Art3D';
import { formatRupees } from '../../../i18n/format';
import { useI18n } from '../../../i18n/I18n';
import { useBackend } from '../../../services/ServicesProvider';
import { useTechSession } from '../../../state/AppState';
import { colors, GUTTER, radius, shadow, space } from '../../../theme/tokens';
import { Banner, Card, DemoPill, Divider, ErrorView, Pill, Screen, Skeleton, Txt } from '../../../ui';

export default function TechEarnings() {
  const { t, l, locale } = useI18n();
  const backend = useBackend();
  const session = useTechSession();
  const insets = useSafeAreaInsets();
  const [e, setE] = useState<Earnings | null>(null);
  const [error, setError] = useState<unknown>(null);

  useFocusEffect(useCallback(() => {
    let alive = true;
    backend.tech.earnings(session.token).then((x) => {
      if (alive) setE(x);
    }, (err: unknown) => {
      if (alive) setError(err);
    });
    return () => {
      alive = false;
    };
  }, [backend, session.token]));

  const dateFmt = (d: Date) => d.toLocaleDateString(locale === 'te' ? 'te-IN' : 'en-IN', { weekday: 'short', day: 'numeric', month: 'short' });

  return (
    <Screen
      testID="tech-earnings"
      header={
        <View style={[styles.header, { paddingTop: insets.top + space.md }]}>
          <Txt variant="title1" heading style={styles.flex}>{t('ttab.earnings')}</Txt>
          <DemoPill />
        </View>
      }
    >
      {error && !e ? <ErrorView error={error} onRetry={() => {
        setError(null);
        backend.tech.earnings(session.token).then(setE, setError);
      }} /> : null}
      {!e && !error ? <Skeleton style={styles.skel} /> : null}
      {e ? (
        <>
          <View style={styles.hero}>
            <View style={styles.flex}>
              <Txt variant="caption" color="onNavy" style={styles.dim}>{t('thome.today')}</Txt>
              <Txt variant="hero" color="onNavy" testID="earn-today">{formatRupees(e.today)}</Txt>
              <Txt variant="footnote" color="onNavy" style={styles.dim}>{t('thome.jobsToday', { n: e.jobsToday })}</Txt>
            </View>
            <Art3D name="earnings" size={96} float />
          </View>
          <View style={styles.row}>
            <Card style={styles.stat}>
              <Txt variant="caption" color="inkMuted">{t('thome.total')}</Txt>
              <Txt variant="title2" testID="earn-total">{formatRupees(e.total)}</Txt>
            </Card>
            <Card style={styles.stat}>
              <Txt variant="caption" color="inkMuted">{t('tearn.pending')}</Txt>
              <Txt variant="title2" color="success" testID="earn-pending">{formatRupees(e.pendingPayout)}</Txt>
              <Txt variant="caption" color="inkMuted">{t('tearn.next', { date: dateFmt(parseIsoDate(e.nextPayoutOn)) })}</Txt>
            </Card>
          </View>

          <Card style={styles.how}>
            <Txt variant="title3" heading>{t('tearn.how')}</Txt>
            <Txt variant="callout" color="inkMuted">{t('tearn.how1', { amount: formatRupees(TECH_VISIT_SHARE) })}</Txt>
            <Txt variant="callout" color="inkMuted">{t('tearn.how2', { pct: Math.round(TECH_LABOUR_SHARE * 100) })}</Txt>
            <Txt variant="callout" color="inkMuted">{t('tearn.how3')}</Txt>
          </Card>

          <Txt variant="title3" heading>{t('tearn.history')}</Txt>
          {e.entries.length === 0 ? <Txt variant="footnote" color="inkMuted">{t('tearn.empty')}</Txt> : (
            <Card style={styles.list}>
              {e.entries.map((x, i) => {
                const svc = serviceById(x.serviceId);
                return (
                  <View key={x.jobId}>
                    {i > 0 ? <Divider /> : null}
                    <View style={styles.entry} testID={`earn-${x.code}`}>
                      <View style={styles.flex}>
                        <Txt variant="bodyStrong" numberOfLines={1}>{svc ? l(svc.name) : x.serviceId}</Txt>
                        <Txt variant="caption" color="inkMuted">{x.code} · {dateFmt(new Date(x.at))}</Txt>
                      </View>
                      <View style={styles.right}>
                        <Txt variant="title3" color="success">{formatRupees(x.amount)}</Txt>
                        <Pill label={x.payout === 'PAID' ? t('tearn.paid') : t('tearn.pendingShort')} tone={x.payout === 'PAID' ? 'success' : 'warning'} />
                      </View>
                    </View>
                  </View>
                );
              })}
            </Card>
          )}
          <Banner tone="demo" text={t('tearn.demo')} />
        </>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  dim: { opacity: 0.85 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: GUTTER, paddingBottom: space.sm },
  skel: { height: 160, borderRadius: radius.xl },
  hero: { flexDirection: 'row', alignItems: 'center', padding: space.xl, borderRadius: radius.xxl, backgroundColor: colors.navy, ...shadow.raised },
  row: { flexDirection: 'row', gap: space.md },
  stat: { flex: 1, gap: 2 },
  how: { gap: space.xs },
  list: { paddingVertical: space.xs },
  entry: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.sm },
  right: { alignItems: 'flex-end', gap: 4 },
});
