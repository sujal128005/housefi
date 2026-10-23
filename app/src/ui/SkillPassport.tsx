// The Skill Passport: a technician's career as they chose to show it (record, proven trades and how, Housefi courses,
// certificates Housefi checked). Shown to the technician on "My Skill Passport" and on the QR verification page.
import { StyleSheet, View } from 'react-native';
import { categoryById } from '../data/catalog';
import type { SkillPassport } from '../domain/types';
import { Art3D } from '../illustrations/Art3D';
import { formatDate } from '../i18n/format';
import { useI18n } from '../i18n/I18n';
import { colors, radius, space } from '../theme/tokens';
import { Icon } from './Icon';
import { Pill } from './Surfaces';
import { Txt } from './Txt';

export function SkillPassportView({ passport: p, testID }: { readonly passport: SkillPassport; readonly testID?: string }) {
  const { t, l, locale } = useI18n();
  return (
    <View style={styles.wrap} testID={testID}>
      <View style={styles.head}>
        <Icon name="ribbon" size={22} color="blue" />
        <Txt variant="title3" heading style={styles.flex}>{t('passport.heading')}</Txt>
      </View>
      <Txt variant="footnote" color="inkMuted">
        {t('passport.memberSince', { date: new Date(p.memberSince).toLocaleDateString(locale === 'te' ? 'te-IN' : 'en-IN', { month: 'long', year: 'numeric', timeZone: 'Asia/Kolkata' }) })}{p.city ? ` · ${p.city}` : ''}
        {p.level ? ` · ${t(`skills.level.${p.level}`)}` : ''}
      </Txt>

      <View style={styles.stats}>
        <Stat value={String(p.jobsDone)} label={t('passport.jobs')} testID="passport-jobs" />
        <Stat value={p.rating !== null ? `★ ${p.rating.toFixed(1)}` : '–'} label={p.rating !== null ? t('passport.reviews', { n: p.ratingCount }) : t('passport.noRating')} />
        <Stat value={String(p.experienceYears)} label={t('passport.years')} />
      </View>

      <Txt variant="label" color="inkMuted">{t('passport.trades')}</Txt>
      {p.trades.length ? p.trades.map((tr) => {
        const c = categoryById(tr.categoryId);
        return (
          <View key={tr.categoryId} style={styles.line} testID={`passport-trade-${tr.categoryId}`}>
            {c ? <Art3D name={c.art} size={32} /> : null}
            <View style={styles.flex}>
              <Txt variant="bodyStrong">{c ? l(c.name) : tr.categoryId}</Txt>
              <Txt variant="footnote" color="inkMuted">
                {t(`skills.via.${tr.provenBy}`)}
                {tr.examPoints !== null && tr.examMaxPoints ? ` · ${t('passport.score', { points: tr.examPoints, max: tr.examMaxPoints })}` : ''}
              </Txt>
            </View>
            <Icon name="checkmark-circle" size={20} color="success" />
          </View>
        );
      }) : <Txt variant="footnote" color="inkMuted">{t('passport.noTrades')}</Txt>}

      {p.courses.length ? (
        <>
          <Txt variant="label" color="inkMuted">{t('passport.courses')}</Txt>
          {p.courses.map((c, i) => (
            <View key={`${c.title}-${i}`} style={styles.line} testID={`passport-course-${i}`}>
              <Icon name="school" size={20} color="blue" />
              <Txt variant="body" style={styles.flex}>{c.title}</Txt>
              <Txt variant="caption" color="inkMuted">{formatDate(new Date(c.at), locale)}</Txt>
            </View>
          ))}
        </>
      ) : null}

      {p.certificates.length ? (
        <>
          <Txt variant="label" color="inkMuted">{t('passport.certificates')}</Txt>
          <View style={styles.pills}>
            {p.certificates.map((c, i) => <Pill key={`${c.kind}-${i}`} tone="success" icon="ribbon" label={c.title || t(`skills.cert.${c.kind}`)} />)}
          </View>
        </>
      ) : null}
    </View>
  );
}

function Stat({ value, label, testID }: { readonly value: string; readonly label: string; readonly testID?: string }) {
  return (
    <View style={styles.stat} testID={testID}>
      <Txt variant="title2" color="navy">{value}</Txt>
      <Txt variant="caption" color="inkMuted" align="center">{label}</Txt>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space.md, padding: space.lg, borderRadius: radius.xxl, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line },
  head: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  flex: { flex: 1 },
  stats: { flexDirection: 'row', gap: space.sm },
  stat: { flex: 1, alignItems: 'center', gap: 2, paddingVertical: space.md, borderRadius: radius.lg, backgroundColor: colors.canvas },
  line: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
});
