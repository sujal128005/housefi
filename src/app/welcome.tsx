// Welcome: the brand screen first (Housefi logo, "Housefi", "by Nexara9", "Home Help, Made Easy."), then three short
// slides (what Housefi is, who comes, how pricing works), then language selection.
import { router } from 'expo-router';
import { useRef, useState } from 'react';
import { ScrollView, StyleSheet, useWindowDimensions, View, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Art3D, type ArtName } from '../illustrations/Art3D';
import { useI18n, type StringKey } from '../i18n/I18n';
import { useAppState } from '../state/AppState';
import { colors, radius, space } from '../theme/tokens';
import { Button, Tap, Txt } from '../ui';
import { BrandLockup, BrandWave } from '../ui/BrandHero';
import { Logo } from '../ui/Logo';
import { MAX_CONTENT, useLayout } from '../ui/responsive';

const SLIDES: readonly { title: StringKey; body: StringKey; art: ArtName; badge?: ArtName }[] = [
  { title: 'welcome.s1.title', body: 'welcome.s1.body', art: 'house_garden' },
  { title: 'welcome.s2.title', body: 'welcome.s2.body', art: 'tech_hero' },
  { title: 'welcome.s3.title', body: 'welcome.s3.body', art: 'clipboard', badge: 'check' },
];

/** Pages: 0 = brand, 1..3 = slides. */
const PAGES = SLIDES.length + 1;

export default function Welcome() {
  const { t } = useI18n();
  const { markWelcomeSeen } = useAppState();
  const { width, height } = useWindowDimensions();
  const layout = useLayout();
  const insets = useSafeAreaInsets();
  const [page, setPage] = useState(0);
  const [pageH, setPageH] = useState(0);
  const scroller = useRef<ScrollView>(null);
  const artSize = Math.min(layout.content, height * 0.34, 280);
  const last = page === PAGES - 1;

  const finish = () => {
    markWelcomeSeen();
    router.push('/language');
  };
  const next = () => {
    if (last) return finish();
    scroller.current?.scrollTo({ x: (page + 1) * width, animated: true });
    setPage(page + 1);
  };
  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const p = Math.round(e.nativeEvent.contentOffset.x / width);
    if (p !== page) setPage(p);
  };

  return (
    <View style={styles.root} testID="welcome">
      <BrandWave height={page === 0 ? 260 : 160} />
      <View style={[styles.top, { paddingTop: insets.top + space.md, paddingHorizontal: layout.gutter }]}>
        {page > 0 ? <Logo size={32} /> : <View />}
        {!last ? (
          <Tap onPress={finish} style={styles.skip} accessibilityLabel={t('welcome.skip')} testID="welcome-skip">
            <Txt variant="label" color="inkMuted">{t('welcome.skip')}</Txt>
          </Tap>
        ) : null}
      </View>
      <ScrollView ref={scroller} horizontal pagingEnabled showsHorizontalScrollIndicator={false} onMomentumScrollEnd={onScroll} style={styles.flex}
        onLayout={(e) => setPageH(e.nativeEvent.layout.height)}>
        <View style={[styles.brandPage, { width, height: pageH || undefined }]} testID="welcome-brand">
          <BrandLockup />
        </View>
        {SLIDES.map((s) => (
          <View key={s.title} style={[styles.slide, { width, height: pageH || undefined, paddingHorizontal: layout.gutter + 4 }]}>
            <View style={styles.column}>
              <View style={[styles.art, { height: artSize }]}>
                <Art3D name={s.art} size={artSize * 0.72} float shadow badge={s.badge} />
              </View>
              <Txt variant="hero" heading>{t(s.title)}</Txt>
              <Txt variant="body" color="inkMuted" style={styles.body}>{t(s.body)}</Txt>
            </View>
          </View>
        ))}
      </ScrollView>
      <View style={[styles.bottom, { paddingBottom: Math.max(insets.bottom, space.lg) + space.sm, paddingHorizontal: layout.gutter }]}>
        <View style={styles.column}>
          <View style={styles.dots} accessibilityLabel={`${page + 1} / ${PAGES}`}>
            {Array.from({ length: PAGES }, (_, k) => <View key={k} style={[styles.dot, k === page && styles.dotOn]} />)}
          </View>
          <Button label={page === 0 ? t('welcome.getStarted') : last ? t('welcome.getStarted') : t('common.next')} trailingIcon="arrow-forward" onPress={next} testID="welcome-next" />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.canvas },
  flex: { flex: 1 },
  column: { width: '100%', maxWidth: MAX_CONTENT, alignSelf: 'center', gap: space.md },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 48 },
  skip: { minHeight: 48, minWidth: 48, alignItems: 'center', justifyContent: 'center' },
  brandPage: { alignItems: 'center', justifyContent: 'center', paddingHorizontal: space.xl },
  slide: { justifyContent: 'center' },
  art: { alignItems: 'center', justifyContent: 'center', marginBottom: space.lg },
  body: { marginTop: space.xs },
  bottom: { gap: space.xl },
  dots: { flexDirection: 'row', gap: space.sm, alignSelf: 'center', marginBottom: space.lg },
  dot: { width: 8, height: 8, borderRadius: radius.pill, backgroundColor: colors.lineStrong },
  dotOn: { width: 24, backgroundColor: colors.navy },
});
