// Step 1 of 4: describe the problem. Photos, a voice note (the demo AI writes it down), common issues, own note.
import { Redirect, router } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { serviceById } from '../../data/catalog';
import { Art3D, type ArtName } from '../../illustrations/Art3D';
import { formatDuration } from '../../i18n/format';
import { useI18n } from '../../i18n/I18n';
import { hasProblem, useDraft } from '../../state/BookingDraft';
import { colors, radius, shadow, space } from '../../theme/tokens';
import { Button, Chip, Field, Icon, Pill, Screen, Tap, Txt } from '../../ui';
import { Appear } from '../../ui/motion';
import { PhotoThumb } from '../../ui/PhotoThumb';
import { StepHeader } from '../../ui/StepHeader';

export default function ProblemStep() {
  const { t, l } = useI18n();
  const { draft, toggleIssue, setNotes, setVoiceNote } = useDraft();
  const svc = draft.serviceId ? serviceById(draft.serviceId) : undefined;
  if (!svc) return <Redirect href="/home" />;
  const p = draft.problem;
  const ready = hasProblem(p);
  const photos = p.photos.length;

  return (
    <Screen
      testID="book-problem"
      header={<StepHeader step={1} title={l(svc.name)} />}
      footer={
        <>
          {!ready ? <Txt variant="footnote" color="inkMuted" align="center">{t('book.issue.needOne')}</Txt> : null}
          <Button label={t('common.next')} trailingIcon="arrow-forward" disabled={!ready} onPress={() => router.push('/book/address')} testID="issue-next" />
        </>
      }
    >
      <Appear style={styles.head}>
        <Txt variant="title1" heading>{t('book.issue.title')}</Txt>
        <Txt variant="callout" color="inkMuted">{t('book.issue.body')}</Txt>
      </Appear>

      <View style={styles.actions}>
        <ActionCard testID="issue-photos" art="camera" title={t('book.issue.photo')} onPress={() => router.push('/book/photos')}
          sub={photos === 0 ? t('book.issue.photoSub') : photos === 1 ? t('book.issue.onePhotoAdded') : t('book.issue.photosAdded', { count: photos })} done={photos > 0} />
        <ActionCard testID="issue-voice" art="mic" title={t('book.issue.speak')} onPress={() => router.push('/book/voice')}
          sub={p.voiceNote ? t('book.issue.voiceAdded', { time: formatDuration(p.voiceNote.durationSec) }) : t('book.issue.speakSub')} done={!!p.voiceNote} />
      </View>

      {photos > 0 ? (
        <View style={styles.thumbs}>
          {p.photos.map((ph) => <PhotoThumb key={ph.id} photo={ph} size={64} />)}
        </View>
      ) : null}

      {p.voiceNote ? (
        <Appear>
          <View style={styles.aiNote} testID="ai-note">
            <View style={styles.aiHead}>
              <Art3D name="robot" size={28} />
              <Txt variant="label" color="demo" style={styles.flex}>{t('voice.aiNote')}</Txt>
              <Pill label={t('common.demo')} tone="demo" />
              <Tap onPress={() => setVoiceNote(null)} accessibilityLabel={t('common.remove')} style={styles.x} testID="ai-note-remove">
                <Icon name="close" size={18} color="inkMuted" />
              </Tap>
            </View>
            <Txt variant="callout">“{p.voiceNote.transcript}”</Txt>
          </View>
        </Appear>
      ) : null}

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

function ActionCard({ art, title, sub, done, onPress, testID }: {
  readonly art: ArtName;
  readonly title: string;
  readonly sub: string;
  readonly done: boolean;
  readonly onPress: () => void;
  readonly testID: string;
}) {
  return (
    <Tap testID={testID} onPress={onPress} haptic style={[styles.action, done && styles.actionDone]} accessibilityLabel={`${title}. ${sub}`}>
      <View style={styles.actionTop}>
        <Art3D name={art} size={56} />
        {done ? <View style={styles.tick}><Icon name="checkmark" size={14} color="onNavy" /></View> : null}
      </View>
      <Txt variant="bodyStrong">{title}</Txt>
      <Txt variant="footnote" color={done ? 'onSuccessTint' : 'inkMuted'}>{sub}</Txt>
    </Tap>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  head: { gap: space.xs },
  actions: { flexDirection: 'row', gap: space.md },
  action: { flex: 1, gap: space.xs, padding: space.lg, borderRadius: radius.xl, backgroundColor: colors.surface, borderWidth: 1.5, borderColor: colors.line, ...shadow.card },
  actionDone: { borderColor: colors.success, backgroundColor: '#FAFFFC' },
  actionTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  tick: { width: 24, height: 24, borderRadius: 12, backgroundColor: colors.success, alignItems: 'center', justifyContent: 'center' },
  thumbs: { flexDirection: 'row', gap: space.sm, flexWrap: 'wrap' },
  aiNote: { gap: space.sm, padding: space.md, borderRadius: radius.lg, backgroundColor: colors.demoTint },
  aiHead: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  x: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  block: { gap: space.md },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
});
