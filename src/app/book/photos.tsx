// Photos of the problem (simulated in demo): add from "camera" or "gallery" (both add a labelled sample picture),
// remove, up to four.
import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { SamplePhoto } from '../../illustrations/CategoryArt';
import { useI18n } from '../../i18n/I18n';
import { MAX_PHOTOS, useDraft } from '../../state/BookingDraft';
import { colors, radius, space } from '../../theme/tokens';
import { Banner, Button, Header, Icon, Screen, Tap, Txt, useToast } from '../../ui';

export default function Photos() {
  const { t } = useI18n();
  const toast = useToast();
  const { draft, addPhoto, removePhoto } = useDraft();
  const photos = draft.problem.photos;
  const full = photos.length >= MAX_PHOTOS;

  const add = () => {
    if (full) {
      toast.show(t('photos.limit', { max: MAX_PHOTOS }), 'information-circle');
      return;
    }
    const used = new Set(photos.map((p) => p.sample));
    const sample = [1, 2, 3, 4].find((n) => !used.has(n)) ?? 1;
    addPhoto({ id: `ph_${Date.now().toString(36)}_${sample}`, sample });
  };

  return (
    <Screen
      testID="photos"
      header={<Header title={t('photos.title')} />}
      footer={<Button label={t('common.done')} onPress={() => router.back()} testID="photos-done" />}
    >
      <Banner tone="demo" text={t('photos.demo')} />
      <Txt variant="callout" color="inkMuted">{t('photos.body', { max: MAX_PHOTOS })}</Txt>

      <View style={styles.grid}>
        {photos.map((p, k) => (
          <View key={p.id} style={styles.cell} testID={`photo-${k + 1}`}>
            <View style={styles.photo}>
              <SamplePhoto n={p.sample} size="100%" />
              <View style={styles.sampleTag}><Txt variant="caption" color="onNavy">{t('photos.sample', { n: k + 1 })}</Txt></View>
            </View>
            <Tap onPress={() => removePhoto(p.id)} style={styles.remove} accessibilityLabel={t('photos.removeLabel', { n: k + 1 })} testID={`photo-remove-${k + 1}`}>
              <Icon name="close" size={18} color="onNavy" />
            </Tap>
          </View>
        ))}
        {!full ? (
          <View style={styles.cell}>
            <View style={[styles.photo, styles.empty]}>
              <Icon name="images-outline" size={32} color="inkSubtle" />
              <Txt variant="footnote" color="inkSubtle">{photos.length === 0 ? t('photos.empty') : `${photos.length} / ${MAX_PHOTOS}`}</Txt>
            </View>
          </View>
        ) : null}
      </View>

      <View style={styles.row}>
        <Button label={t('photos.camera')} icon="camera" variant="secondary" onPress={add} disabled={full} style={styles.flex} testID="photos-camera" />
        <Button label={t('photos.gallery')} icon="images" variant="secondary" onPress={add} disabled={full} style={styles.flex} testID="photos-gallery" />
      </View>
      {full ? <Banner tone="info" text={t('photos.limit', { max: MAX_PHOTOS })} /> : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -space.xs, rowGap: space.sm },
  cell: { width: '50%', paddingHorizontal: space.xs },
  photo: { aspectRatio: 1, borderRadius: radius.lg, overflow: 'hidden', alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surfaceMuted },
  empty: { borderWidth: 2, borderStyle: 'dashed', borderColor: colors.lineStrong, gap: space.xs },
  sampleTag: { position: 'absolute', left: 8, bottom: 8, backgroundColor: 'rgba(16,24,51,0.7)', borderRadius: radius.pill, paddingHorizontal: space.sm, paddingVertical: 2 },
  remove: { position: 'absolute', top: 6, right: space.xs + 6, width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(16,24,51,0.75)', alignItems: 'center', justifyContent: 'center' },
  row: { flexDirection: 'row', gap: space.md },
});
