// Step 1: describe the problem by tapping common issues, recording a voice note, adding photos, or writing a note.
import { Redirect, router } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { serviceById } from '../../data/catalog';
import { formatDuration } from '../../i18n/format';
import { useI18n } from '../../i18n/I18n';
import { hasProblem, useDraft } from '../../state/BookingDraft';
import { colors, radius, shadow, space } from '../../theme/tokens';
import { Button, Chip, Field, Icon, Screen, Tap, Txt, type IconName } from '../../ui';
import { StepHeader } from '../../ui/StepHeader';

export default function IssueStep() {
  const { t, l } = useI18n();
  const { draft, toggleIssue, setNotes } = useDraft();
  const svc = draft.serviceId ? serviceById(draft.serviceId) : undefined;
  if (!svc) return <Redirect href="/home" />;
  const p = draft.problem;
  const ready = hasProblem(p);
  const photos = p.photos.length;

  return (
    <Screen
      testID="book-issue"
      header={<StepHeader step={1} title={l(svc.name)} />}
      footer={
        <>
          {!ready ? <Txt variant="footnote" color="inkMuted" align="center">{t('book.issue.needOne')}</Txt> : null}
          <Button label={t('common.next')} trailingIcon="arrow-forward" disabled={!ready} onPress={() => router.push('/book/summary')} testID="issue-next" />
        </>
      }
    >
      <View style={styles.head}>
        <Txt variant="title1" heading>{t('book.issue.title')}</Txt>
        <Txt variant="callout" color="inkMuted">{t('book.issue.body')}</Txt>
      </View>

      <View style={styles.actions}>
        <ActionCard
          testID="issue-voice"
          icon="mic"
          tint={colors.blue}
          title={t('book.issue.speak')}
          sub={p.voiceNote ? t('book.issue.voiceAdded', { time: formatDuration(p.voiceNote.durationSec) }) : t('book.issue.speakSub')}
          done={!!p.voiceNote}
          onPress={() => router.push('/book/voice')}
        />
        <ActionCard
          testID="issue-photos"
          icon="camera"
          tint={colors.orange}
          title={t('book.issue.photo')}
          sub={photos === 0 ? t('book.issue.photoSub') : photos === 1 ? t('book.issue.onePhotoAdded') : t('book.issue.photosAdded', { count: photos })}
          done={photos > 0}
          onPress={() => router.push('/book/photos')}
        />
      </View>

      <View style={styles.block}>
        <Txt variant="title3" heading>{t('book.issue.choose')}</Txt>
        <View style={styles.chips}>
          {svc.issues.map((x) => (
            <Chip key={x.id} testID={`issue-${x.id}`} label={l(x.name)} selected={p.issueIds.includes(x.id)} onPress={() => toggleIssue(x.id)} />
          ))}
        </View>
      </View>

      <Field
        testID="issue-notes"
        label={t('book.issue.notes')}
        optional
        value={p.notes}
        onChangeText={setNotes}
        placeholder={t('book.issue.notesPlaceholder')}
        multiline
        maxLength={300}
        textAlignVertical="top"
      />
    </Screen>
  );
}

function ActionCard({ icon, tint, title, sub, done, onPress, testID }: {
  readonly icon: IconName;
  readonly tint: string;
  readonly title: string;
  readonly sub: string;
  readonly done: boolean;
  readonly onPress: () => void;
  readonly testID: string;
}) {
  return (
    <Tap testID={testID} onPress={onPress} haptic style={[styles.action, done && styles.actionDone]} accessibilityLabel={`${title}. ${sub}`}>
      <View style={[styles.actionIcon, { backgroundColor: tint }]}>
        <Icon name={done ? 'checkmark' : icon} size={26} color="onNavy" />
      </View>
      <Txt variant="bodyStrong">{title}</Txt>
      <Txt variant="footnote" color={done ? 'onSuccessTint' : 'inkMuted'}>{sub}</Txt>
    </Tap>
  );
}

const styles = StyleSheet.create({
  head: { gap: space.xs },
  actions: { flexDirection: 'row', gap: space.md },
  action: { flex: 1, gap: space.sm, padding: space.lg, borderRadius: radius.xl, backgroundColor: colors.surface, borderWidth: 1.5, borderColor: colors.line, ...shadow.card },
  actionDone: { borderColor: colors.success, backgroundColor: '#FAFFFC' },
  actionIcon: { width: 52, height: 52, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  block: { gap: space.md },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
});
