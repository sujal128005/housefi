// "Snap the problem": add a photo first; the (demo) AI suggests which service it is, the customer confirms or picks
// another, and the photo carries into the booking.
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { categoryById, serviceById } from '../../data/catalog';
import type { Photo } from '../../domain/types';
import { Art3D } from '../../illustrations/Art3D';
import { SAMPLE_PHOTOS, SamplePhoto } from '../../illustrations/SamplePhoto';
import { formatRupees } from '../../i18n/format';
import { useI18n } from '../../i18n/I18n';
import type { PhotoSuggestion } from '../../services/api';
import { pickPhoto } from '../../services/device';
import { useBackend } from '../../services/ServicesProvider';
import { useDraft } from '../../state/BookingDraft';
import { colors, radius, space } from '../../theme/tokens';
import { Banner, Button, Card, Header, Icon, Pill, Screen, Tap, Txt, useToast } from '../../ui';
import { CategoryBadge } from '../../ui/CategoryTile';
import { Appear, Pop, Pulse } from '../../ui/motion';
import { PhotoThumb } from '../../ui/PhotoThumb';
import { feedback } from '../../services/feedback';
import { useSession } from '../../state/AppState';

export default function Snap() {
  const { t, l } = useI18n();
  const backend = useBackend();
  const draft = useDraft();
  const toast = useToast();
  const session = useSession();
  const [photo, setPhoto] = useState<Photo | null>(null);
  const [result, setResult] = useState<PhotoSuggestion | null>(null);

  useEffect(() => {
    if (!photo) return;
    let alive = true;
    setResult(null);
    void backend.ai.classifyPhoto(session.token, photo).then((r) => {
      if (!alive) return;
      feedback(r.serviceId ? 'success' : 'pop');
      setResult(r);
    }, () => {
      // No answer (no network, upload refused): the person picks the service themselves.
      if (alive) setResult({ serviceId: null, confidence: 0, alternatives: [] });
    });
    return () => {
      alive = false;
    };
  }, [photo, backend, session.token]);

  const take = async (source: 'camera' | 'gallery') => {
    const r = await pickPhoto(source);
    if (r.ok) setPhoto({ id: `ph_${Date.now().toString(36)}`, uri: r.uri });
    else if (r.reason === 'DENIED') toast.show(t('photos.denied'), 'lock-closed');
    else if (r.reason === 'UNAVAILABLE') toast.show(t('photos.unavailable'), 'information-circle');
  };

  const choose = (serviceId: string) => {
    if (photo) {
      draft.clear();
      draft.addPhoto(photo);
    }
    draft.start(serviceId);
    router.replace('/book/problem');
  };

  const suggested = result?.serviceId ? serviceById(result.serviceId) : undefined;

  return (
    <Screen testID="book-snap" wash="sky" header={<Header title={t('snap.title')} />}>
      {!photo ? (
        <>
          <Appear style={styles.hero}>
            <Art3D name="camera" size={120} float shadow />
          </Appear>
          <Txt variant="title1" align="center" heading>{t('snap.heading')}</Txt>
          <Txt variant="callout" color="inkMuted" align="center">{t('snap.body')}</Txt>
          <View style={styles.row}>
            <Button label={t('photos.camera')} icon="camera" onPress={() => void take('camera')} style={styles.flex} testID="snap-camera" />
            <Button label={t('photos.gallery')} icon="images" variant="secondary" onPress={() => void take('gallery')} style={styles.flex} testID="snap-gallery" />
          </View>
          <Txt variant="label" color="inkMuted">{t('snap.samples')}</Txt>
          <View style={styles.samples}>
            {SAMPLE_PHOTOS.map((n) => (
              <Tap key={n} onPress={() => setPhoto({ id: `sample_${n}_${Date.now().toString(36)}`, sample: n })} style={styles.sample}
                accessibilityLabel={t('photos.sample', { n })} testID={`snap-sample-${n}`} haptic>
                <SamplePhoto n={n} size="100%" />
              </Tap>
            ))}
          </View>
        </>
      ) : (
        <>
          <View style={styles.preview}>
            <PhotoThumb photo={photo} size="100%" />
            {!result ? (
              <View style={styles.scan}>
                <Pulse size={160} color={colors.surface} />
                <Art3D name="magnifier" size={72} float />
                <Txt variant="bodyStrong" color="onNavy">{t('snap.analyzing')}</Txt>
              </View>
            ) : null}
          </View>
          {result ? (
            <Appear style={styles.result}>
              {suggested ? (
                <Card style={styles.resultCard} testID="snap-suggestion">
                  <View style={styles.row}>
                    <Pill label={t('snap.aiDemo')} tone="info" icon="sparkles" />
                    <Txt variant="caption" color="success">{t('snap.match', { pct: Math.round(result.confidence * 100) })}</Txt>
                  </View>
                  <View style={styles.svcRow}>
                    {categoryById(suggested.categoryId) ? <CategoryBadge category={categoryById(suggested.categoryId)!} serviceId={suggested.id} size={60} /> : null}
                    <View style={styles.flex}>
                      <Txt variant="caption" color="inkMuted">{t('snap.looksLike')}</Txt>
                      <Txt variant="title3">{l(suggested.name)}</Txt>
                      <Txt variant="footnote" color="inkMuted">{t('catalog.visitOnly', { fee: formatRupees(suggested.visitFee) })}</Txt>
                    </View>
                  </View>
                  <Pop><Button label={t('snap.continue')} trailingIcon="arrow-forward" onPress={() => choose(suggested.id)} testID="snap-continue" /></Pop>
                </Card>
              ) : (
                <Banner tone="info" icon="sparkles" text={t('snap.cantRead')} testID="snap-cant-read" />
              )}
              <Txt variant="label" color="inkMuted">{suggested ? t('snap.notRight') : t('snap.pickOne')}</Txt>
              {result.alternatives.map((sid) => {
                const s = serviceById(sid);
                const c = s ? categoryById(s.categoryId) : undefined;
                return s && c ? (
                  <Tap key={sid} onPress={() => choose(sid)} style={styles.alt} accessibilityLabel={l(s.name)} testID={`snap-alt-${sid}`}>
                    <CategoryBadge category={c} size={44} />
                    <Txt variant="bodyStrong" style={styles.flex}>{l(s.name)}</Txt>
                    <Icon name="chevron-forward" size={18} color="inkSubtle" />
                  </Tap>
                ) : null;
              })}
              <Button label={t('snap.retake')} icon="refresh" variant="outline" size="md" onPress={() => setPhoto(null)} testID="snap-retake" />
              <Button label={t('catalog.all')} variant="ghost" size="md" onPress={() => router.push('/services')} />
            </Appear>
          ) : null}
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  hero: { alignItems: 'center', marginTop: space.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm, justifyContent: 'space-between' },
  samples: { flexDirection: 'row', gap: space.sm },
  sample: { flex: 1, aspectRatio: 1, borderRadius: radius.md, overflow: 'hidden', borderWidth: 2, borderColor: colors.surface },
  preview: { width: '100%', aspectRatio: 1.3, borderRadius: radius.xl, overflow: 'hidden', backgroundColor: colors.surfaceMuted },
  scan: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(19,35,91,0.55)', alignItems: 'center', justifyContent: 'center', gap: space.sm },
  result: { gap: space.md },
  resultCard: { gap: space.md, borderColor: colors.successTint, borderWidth: 2 },
  svcRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  alt: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 60, padding: space.sm, borderRadius: radius.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line },
});
