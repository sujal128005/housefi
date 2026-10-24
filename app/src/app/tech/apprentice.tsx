// Apprentice mode. For a technician still learning a trade: choose a mentor, see the jobs the mentor takes them on (time,
// place, the mentor's number) and what they earned (Housefi pays for each job they help on), then take the skill exam.
// For an experienced technician: offer to teach, answer requests, and see their apprentices.
import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Switch, View } from 'react-native';
import { categoryById, serviceById } from '../../data/catalog';
import type { ApprenticeLink, ApprenticeOverview, ApprenticePerson, CategoryId, TraineeJob } from '../../domain/types';
import { Art3D } from '../../illustrations/Art3D';
import { formatRupees } from '../../i18n/format';
import { useI18n } from '../../i18n/I18n';
import { dial } from '../../services/calls';
import { useBackend, useQuery } from '../../services/ServicesProvider';
import { useTechSession } from '../../state/AppState';
import { colors, radius, space } from '../../theme/tokens';
import { Banner, Button, Card, Chip, ConfirmSheet, EmptyState, ErrorBanner, ErrorView, Header, Pill, Screen, Skeleton, Txt, useToast } from '../../ui';
import { visitTimeText } from '../../ui/present';
import { TechPhoto } from '../../ui/TechIdentity';

export default function Apprentice() {
  const { t, l } = useI18n();
  const backend = useBackend();
  const session = useTechSession();
  const toast = useToast();
  const q = useQuery(() => backend.tech.apprentice(session.token), [backend, session.token]);
  const [saved, setSaved] = useState<ApprenticeOverview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [ending, setEnding] = useState<ApprenticeLink | null>(null);
  const o = saved ?? q.data;

  const run = async (f: () => Promise<ApprenticeOverview>, okMsg?: string) => {
    setBusy(true);
    setError(null);
    try {
      setSaved(await f());
      if (okMsg) toast.show(okMsg, 'checkmark-circle');
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  const tradeName = (c: CategoryId) => {
    const cat = categoryById(c);
    return cat ? l(cat.name) : c;
  };

  if (!o) {
    return (
      <Screen testID="tech-apprentice" header={<Header title={t('appr.title')} onBack={() => router.back()} />}>
        {q.error ? <ErrorView error={q.error} onRetry={q.reload} /> : <Skeleton style={styles.skel} />}
      </Screen>
    );
  }

  const L = o.learner;
  const M = o.mentor;
  const link = L.link;
  const open = link && (link.state === 'REQUESTED' || link.state === 'ACTIVE') ? link : null;
  const learning = L.eligible || !!open || L.jobs.length > 0;
  const teaching = M.trades.length > 0;

  return (
    <Screen testID="tech-apprentice" header={<Header title={t('appr.title')} onBack={() => router.back()} />}>
      <View style={styles.hero}><Art3D name="handshake" size={96} float /></View>
      <Txt variant="callout" color="inkMuted" align="center">{t('appr.intro', { amount: formatRupees(o.shareRupees) })}</Txt>
      <ErrorBanner error={error} />

      {!learning && !teaching ? (
        <EmptyState art={<Art3D name="no_results" size={110} />} title={t('appr.none')} body={L.block === 'IDENTITY' ? t('appr.blockIdentity') : t('appr.noneBody')} testID="appr-none" />
      ) : null}

      {learning ? (
        <>
          <Txt variant="title3" heading>{t('appr.learnTitle')}</Txt>
          {open?.state === 'ACTIVE' ? (
            <Card style={styles.card} testID="appr-mentor">
              <Txt variant="label" color="inkMuted">{t('appr.yourMentor', { trade: tradeName(open.categoryId) })}</Txt>
              <PersonRow person={open.other} onCall={open.other.phone ? () => void dial(open.other.phone!) : undefined} />
              <Progress jobs={L.helped.find((h) => h.categoryId === open.categoryId)?.jobs ?? 0} target={o.jobsTarget} />
              {(L.helped.find((h) => h.categoryId === open.categoryId)?.jobs ?? 0) >= o.jobsTarget ? (
                <Banner tone="success" icon="school" text={t('appr.readyExam')} action={t('appr.takeExam')} onAction={() => router.push('/tech/skills')} testID="appr-ready" />
              ) : null}
              <Button label={t('appr.end')} variant="ghost" size="md" onPress={() => setEnding(open)} testID="appr-end" />
            </Card>
          ) : open?.state === 'REQUESTED' ? (
            <Card style={styles.card} testID="appr-waiting">
              <Txt variant="bodyStrong">{t('appr.waiting', { name: open.other.name })}</Txt>
              <Txt variant="footnote" color="inkMuted">{t('appr.waitingSub')}</Txt>
              <Button label={t('appr.takeBack')} variant="outline" size="md" loading={busy} onPress={() => void run(() => backend.tech.endApprenticeship(session.token, open.id))} testID="appr-take-back" />
            </Card>
          ) : L.eligible ? (
            <ChooseMentor overview={o} declined={link?.state === 'DECLINED' ? link.other.name : null} busy={busy}
              onAsk={(mentorId, categoryId) => void run(() => backend.tech.requestMentor(session.token, mentorId, categoryId), t('appr.asked'))} />
          ) : null}

          {L.jobs.length ? <Txt variant="label" color="inkMuted">{t('appr.jobs')}</Txt> : null}
          {L.jobs.map((j) => <TraineeJobCard key={j.id} job={j} />)}
        </>
      ) : null}

      {teaching ? (
        <>
          <Txt variant="title3" heading>{t('appr.teachTitle')}</Txt>
          <Card style={styles.card}>
            <View style={styles.row}>
              <View style={styles.flex}>
                <Txt variant="bodyStrong">{t('appr.canTeach')}</Txt>
                <Txt variant="footnote" color="inkMuted">{t('appr.canTeachSub', { trades: M.trades.map(tradeName).join(', '), max: M.max })}</Txt>
              </View>
              <Switch value={M.open} disabled={busy} onValueChange={(v) => void run(() => backend.tech.setMentoring(session.token, v))} testID="appr-mentoring"
                trackColor={{ true: colors.blue, false: colors.lineStrong }} thumbColor={colors.surface} accessibilityLabel={t('appr.canTeach')} />
            </View>
          </Card>
          {M.requests.map((r) => (
            <Card key={r.id} style={styles.card} testID={`appr-request-${r.id}`}>
              <Txt variant="label" color="inkMuted">{t('appr.request', { trade: tradeName(r.categoryId) })}</Txt>
              <PersonRow person={r.other} />
              <View style={styles.row}>
                <Button label={t('appr.accept')} icon="checkmark" size="md" style={styles.flex} loading={busy}
                  onPress={() => void run(() => backend.tech.answerApprentice(session.token, r.id, true), t('appr.accepted'))} testID={`appr-accept-${r.id}`} />
                <Button label={t('appr.decline')} variant="outline" size="md" style={styles.flex} disabled={busy}
                  onPress={() => void run(() => backend.tech.answerApprentice(session.token, r.id, false))} testID={`appr-decline-${r.id}`} />
              </View>
            </Card>
          ))}
          {M.apprentices.map((a) => (
            <Card key={a.id} style={styles.card} testID={`appr-apprentice-${a.id}`}>
              <Txt variant="label" color="inkMuted">{t('appr.yourApprentice', { trade: tradeName(a.categoryId) })}</Txt>
              <PersonRow person={a.other} onCall={a.other.phone ? () => void dial(a.other.phone!) : undefined} />
              <Txt variant="footnote" color="inkMuted">{t('appr.howToBring')}</Txt>
              <Button label={t('appr.end')} variant="ghost" size="md" onPress={() => setEnding(a)} />
            </Card>
          ))}
        </>
      ) : null}

      <ConfirmSheet visible={!!ending} title={t('appr.endTitle')} body={t('appr.endBody')} icon="close-circle" confirmLabel={t('appr.end')} confirmVariant="danger"
        onCancel={() => setEnding(null)} onConfirm={() => { const e = ending; setEnding(null); if (e) void run(() => backend.tech.endApprenticeship(session.token, e.id)); }} />
    </Screen>
  );

  function ChooseMentor({ overview, declined, busy: working, onAsk }: { readonly overview: ApprenticeOverview; readonly declined: string | null; readonly busy: boolean; readonly onAsk: (mentorId: string, c: CategoryId) => void }) {
    const [trade, setTrade] = useState<CategoryId>(overview.learner.trades[0]!);
    const mentors = useQuery(() => backend.tech.mentors(session.token, trade), [backend, session.token, trade]);
    return (
      <Card style={styles.card} testID="appr-choose">
        {declined ? <Banner tone="info" text={t('appr.declinedBefore', { name: declined })} /> : null}
        <Txt variant="bodyStrong">{t('appr.chooseTrade')}</Txt>
        <View style={styles.chips}>
          {overview.learner.trades.map((c) => <Chip key={c} label={tradeName(c)} selected={c === trade} onPress={() => setTrade(c)} testID={`appr-trade-${c}`} />)}
        </View>
        <Txt variant="bodyStrong">{t('appr.chooseMentor')}</Txt>
        {mentors.loading && !mentors.data ? <Skeleton style={styles.skelRow} /> : null}
        {mentors.error ? <ErrorView error={mentors.error} onRetry={mentors.reload} /> : null}
        {mentors.data && mentors.data.length === 0 ? <Txt variant="footnote" color="inkMuted" testID="appr-no-mentors">{t('appr.noMentors')}</Txt> : null}
        {mentors.data?.map((m) => (
          <View key={m.id} style={styles.mentor} testID={`appr-mentor-${m.id}`}>
            <PersonRow person={m} />
            <Button label={t('appr.ask')} icon="paper-plane" size="md" loading={working} onPress={() => onAsk(m.id, trade)} testID={`appr-ask-${m.id}`} />
          </View>
        ))}
        <Txt variant="caption" color="inkMuted">{t('appr.phoneNote')}</Txt>
      </Card>
    );
  }

  function PersonRow({ person: p, onCall }: { readonly person: ApprenticePerson; readonly onCall?: () => void }) {
    return (
      <View style={styles.row}>
        <TechPhoto photo={p.photo} gender={p.gender} size={48} />
        <View style={styles.flex}>
          <Txt variant="bodyStrong">{p.name}</Txt>
          <Txt variant="footnote" color="inkMuted">
            {[p.rating !== null ? `★ ${p.rating.toFixed(1)}` : null, t('appr.jobsDone', { n: p.jobsDone }), p.level ? t(`skills.level.${p.level}`) : null].filter(Boolean).join(' · ')}
          </Txt>
        </View>
        {onCall ? <Button label={t('appr.call')} icon="call" variant="secondary" size="md" onPress={onCall} /> : null}
      </View>
    );
  }

  function Progress({ jobs, target }: { readonly jobs: number; readonly target: number }) {
    return (
      <View style={styles.progress} testID="appr-progress">
        <View style={styles.row}>
          <Txt variant="label" style={styles.flex}>{t('appr.progress')}</Txt>
          <Txt variant="label" color="navy">{t('appr.progressN', { n: Math.min(jobs, target), target })}</Txt>
        </View>
        <View style={styles.track}><View style={[styles.fill, { width: `${Math.min(100, (jobs / target) * 100)}%` }]} /></View>
      </View>
    );
  }

  function TraineeJobCard({ job: j }: { readonly job: TraineeJob }) {
    const { locale } = useI18n();
    const svc = serviceById(j.serviceId);
    const a = j.address;
    return (
      <Card style={styles.card} testID={`appr-job-${j.id}`}>
        <View style={styles.row}>
          <Txt variant="bodyStrong" style={styles.flex}>{svc ? l(svc.name) : j.serviceId}</Txt>
          <Pill tone={j.status === 'COMPLETED' ? 'success' : j.status === 'CANCELLED' ? 'neutral' : 'info'} label={t(`status.${j.status}`)} />
        </View>
        <Txt variant="footnote" color="inkMuted">{j.code} · {visitTimeText(j.time, locale, t)}</Txt>
        {a ? <Txt variant="callout">{[a.house, a.street, a.landmark, `${a.city} ${a.pincode}`].filter(Boolean).join(', ')}</Txt> : null}
        <View style={styles.row}>
          <Txt variant="footnote" color="inkMuted" style={styles.flex}>{t('appr.withMentor', { name: j.mentor.name })}</Txt>
          {['ASSIGNED', 'EN_ROUTE', 'ARRIVED', 'INSPECTING', 'QUOTE_SHARED', 'IN_PROGRESS', 'EXTRA_WORK'].includes(j.status) ? (
            <Button label={t('appr.call')} icon="call" variant="secondary" size="md" onPress={() => void dial(j.mentor.phone)} />
          ) : null}
        </View>
        {j.earning > 0 ? <Pill tone="success" icon="cash" label={t('appr.earned', { amount: formatRupees(j.earning) })} /> : null}
        {j.helped === null && j.status === 'COMPLETED' ? <Txt variant="caption" color="inkMuted">{t('appr.waitConfirm')}</Txt> : null}
      </Card>
    );
  }
}

const styles = StyleSheet.create({
  skel: { height: 320, borderRadius: radius.xxl },
  skelRow: { height: 64, borderRadius: radius.lg },
  hero: { alignItems: 'center' },
  card: { gap: space.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  flex: { flex: 1 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  mentor: { gap: space.sm, paddingVertical: space.sm, borderTopWidth: 1, borderTopColor: colors.line },
  progress: { gap: space.xs },
  track: { height: 10, borderRadius: radius.pill, backgroundColor: colors.surfaceMuted, overflow: 'hidden' },
  fill: { height: '100%', backgroundColor: colors.success },
});
