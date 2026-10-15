// Step 2: confirm the problem description before choosing where and when.
import { Redirect, router } from 'expo-router';
import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { categoryById, serviceById } from '../../data/catalog';
import { SamplePhoto } from '../../illustrations/CategoryArt';
import { formatDuration } from '../../i18n/format';
import { useI18n } from '../../i18n/I18n';
import { hasProblem, useDraft } from '../../state/BookingDraft';
import { colors, radius, space } from '../../theme/tokens';
import { Button, Card, Divider, Icon, Pill, Screen, Tap, Txt } from '../../ui';
import { CategoryBadge } from '../../ui/CategoryTile';
import { StepHeader } from '../../ui/StepHeader';

export default function ProblemSummary() {
  const { t, l } = useI18n();
  const { draft } = useDraft();
  const svc = draft.serviceId ? serviceById(draft.serviceId) : undefined;
  if (!svc || !hasProblem(draft.problem)) return <Redirect href="/home" />;
  const cat = categoryById(svc.categoryId);
  const p = draft.problem;
  const issues = svc.issues.filter((x) => p.issueIds.includes(x.id));

  return (
    <Screen
      testID="book-summary"
      header={<StepHeader step={2} />}
      footer={<Button label={t('summary.looksGood')} icon="checkmark" onPress={() => router.push('/book/address')} testID="summary-next" />}
    >
      <View style={styles.head}>
        <Txt variant="title1" heading>{t('summary.title')}</Txt>
        <Txt variant="callout" color="inkMuted">{t('summary.body')}</Txt>
      </View>
      <Card style={styles.card}>
        <View style={styles.svcRow}>
          {cat ? <CategoryBadge category={cat} size={48} /> : null}
          <View style={styles.flex}>
            <Txt variant="caption" color="inkMuted">{t('summary.service')}</Txt>
            <Txt variant="bodyStrong">{l(svc.name)}</Txt>
          </View>
        </View>
        <Divider />
        <Section title={t('summary.issues')} onEdit={() => router.back()} testID="summary-edit-issues">
          {issues.length > 0 ? (
            <View style={styles.chips}>{issues.map((x) => <Pill key={x.id} label={l(x.name)} tone="info" icon="checkmark" />)}</View>
          ) : <Txt variant="callout" color="inkSubtle">{t('summary.none')}</Txt>}
        </Section>
        <Divider />
        <Section title={t('summary.notes')} onEdit={() => router.back()}>
          <Txt variant="callout" color={p.notes.trim() ? 'ink' : 'inkSubtle'}>{p.notes.trim() || t('summary.none')}</Txt>
        </Section>
        <Divider />
        <Section title={t('summary.voice')} onEdit={() => router.push('/book/voice')}>
          {p.voiceNote ? (
            <View style={styles.voice}>
              <View style={styles.play}><Icon name="mic" size={16} color="onNavy" /></View>
              <View style={styles.waveLine} />
              <Txt variant="label">{formatDuration(p.voiceNote.durationSec)}</Txt>
              <Pill label={t('common.demo')} tone="demo" />
            </View>
          ) : <Txt variant="callout" color="inkSubtle">{t('summary.none')}</Txt>}
        </Section>
        <Divider />
        <Section title={t('summary.photos')} onEdit={() => router.push('/book/photos')}>
          {p.photos.length > 0 ? (
            <View style={styles.thumbs}>
              {p.photos.map((ph) => <View key={ph.id} style={styles.thumb}><SamplePhoto n={ph.sample} size={64} /></View>)}
            </View>
          ) : <Txt variant="callout" color="inkSubtle">{t('summary.none')}</Txt>}
        </Section>
      </Card>
    </Screen>
  );
}

function Section({ title, onEdit, children, testID }: { readonly title: string; readonly onEdit: () => void; readonly children: ReactNode; readonly testID?: string }) {
  const { t } = useI18n();
  return (
    <View style={styles.section}>
      <View style={styles.sectionHead}>
        <Txt variant="caption" color="inkMuted" style={styles.flex}>{title}</Txt>
        <Tap onPress={onEdit} style={styles.edit} accessibilityLabel={`${t('common.edit')} ${title}`} testID={testID}>
          <Txt variant="label" color="blue">{t('common.edit')}</Txt>
        </Tap>
      </View>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  head: { gap: space.xs },
  card: { gap: space.md },
  svcRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  section: { gap: space.xs },
  sectionHead: { flexDirection: 'row', alignItems: 'center' },
  edit: { minHeight: 36, minWidth: 48, alignItems: 'flex-end', justifyContent: 'center' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  voice: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  play: { width: 32, height: 32, borderRadius: 16, backgroundColor: colors.blue, alignItems: 'center', justifyContent: 'center' },
  waveLine: { flex: 1, height: 4, borderRadius: 2, backgroundColor: colors.blueTint },
  thumbs: { flexDirection: 'row', gap: space.sm, flexWrap: 'wrap' },
  thumb: { width: 64, height: 64, borderRadius: radius.md, overflow: 'hidden' },
});
