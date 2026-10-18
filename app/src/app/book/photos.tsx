// Photos of the problem: camera or gallery pictures, uploaded with the booking (location data removed).
// Up to four; tap the cross to remove one.
import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { useI18n } from '../../i18n/I18n';
import { pickPhoto } from '../../services/device';
import { MAX_PHOTOS, useDraft } from '../../state/BookingDraft';
import { colors, radius, space } from '../../theme/tokens';
import { Banner, Button, Header, Icon, Screen, Tap, Txt, useToast } from '../../ui';
import { Pop } from '../../ui/motion';
import { PhotoThumb } from '../../ui/PhotoThumb';

export default function Photos() {
  const { t } = useI18n();
  const toast = useToast();
  const { draft, addPhoto, removePhoto } = useDraft();
  const photos = draft.problem.photos;
  const full = photos.length >= MAX_PHOTOS;

  const add = async (source: 'camera' | 'gallery') => {
    if (full) return toast.show(t('photos.limit', { max: MAX_PHOTOS }), 'information-circle');
    const r = await pickPhoto(source);
    if (r.ok) addPhoto({ id: `ph_${Date.now().toString(36)}`, uri: r.uri });
    else if (r.reason === 'DENIED') toast.show(t('photos.denied'), 'lock-closed');
    else if (r.reason === 'UNAVAILABLE') toast.show(t('photos.unavailable'), 'information-circle');
  };

  return (
    <Screen testID="photos" header={<Header title={t('photos.title')} />} footer={<Button label={t('common.done')} onPress={() => router.back()} testID="photos-done" />}>
      <Txt variant="callout" color="inkMuted">{t('photos.body', { max: MAX_PHOTOS })}</Txt>
      <View style={styles.grid}>
        {photos.map((p, k) => (
          <Pop key={p.id} style={styles.cell}>
            <View style={styles.photo} testID={`photo-${k + 1}`}>
              <PhotoThumb photo={p} size="100%" />
            </View>
            <Tap onPress={() => removePhoto(p.id)} style={styles.remove} accessibilityLabel={t('photos.removeLabel', { n: k + 1 })} testID={`photo-remove-${k + 1}`}>
              <Icon name="close" size={18} color="onNavy" />
            </Tap>
          </Pop>
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
        <Button label={t('photos.camera')} icon="camera" variant="secondary" onPress={() => void add('camera')} disabled={full} style={styles.flex} testID="photos-camera" />
        <Button label={t('photos.gallery')} icon="images" variant="secondary" onPress={() => void add('gallery')} disabled={full} style={styles.flex} testID="photos-gallery" />
      </View>
      <Banner tone="info" icon="lock-closed" text={t('photos.private')} />
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
  remove: { position: 'absolute', top: 6, right: space.xs + 6, width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(16,24,51,0.75)', alignItems: 'center', justifyContent: 'center' },
  row: { flexDirection: 'row', gap: space.md },
});
