// Welcome: three short slides (what Housefi is, who comes, how pricing works), then language selection.
import { router } from 'expo-router';
import { useRef, useState } from 'react';
import { ScrollView, StyleSheet, useWindowDimensions, View, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Art3D } from '../illustrations/Art3D';
import { useI18n, type StringKey } from '../i18n/I18n';
import { useAppState } from '../state/AppState';
import { colors, GUTTER, radius, space } from '../theme/tokens';
import { Button, Tap, Txt, Wash } from '../ui';
import { Logo } from '../ui/Logo';

const SLIDES: readonly { title: StringKey; body: StringKey; art: 'house' | 'mascot' | 'calendar' }[] = [
  { title: 'welcome.s1.title', body: 'welcome.s1.body', art: 'house' },
  { title: 'welcome.s2.title', body: 'welcome.s2.body', art: 'mascot' },
  { title: 'welcome.s3.title', body: 'welcome.s3.body', art: 'calendar' },
];

export default function Welcome() {
  const { t } = useI18n();
  const { markWelcomeSeen } = useAppState();
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [page, setPage] = useState(0);
  const scroller = useRef<ScrollView>(null);
  const artSize = Math.min(width - GUTTER * 2, height * 0.36, 300);
  const last = page === SLIDES.length - 1;

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
      <Wash name="sunrise" style={StyleSheet.absoluteFill} />
      <View style={[styles.top, { paddingTop: insets.top + space.md }]}>
        <Logo />
        {!last ? (
          <Tap onPress={finish} style={styles.skip} accessibilityLabel={t('welcome.skip')} testID="welcome-skip">
            <Txt variant="label" color="inkMuted">{t('welcome.skip')}</Txt>
          </Tap>
        ) : null}
      </View>
      <ScrollView
        ref={scroller}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={onScroll}
        style={styles.flex}
      >
        {SLIDES.map((s) => (
          <View key={s.title} style={[styles.slide, { width }]}>
            <View style={[styles.art, { height: artSize }]}>
              {s.art === 'house' ? <Art3D name="house_garden" size={artSize * 0.8} float shadow /> : null}
              {s.art === 'mascot' ? <Art3D name="tech_man" size={artSize * 0.8} float shadow badge="toolbox" /> : null}
              {s.art === 'calendar' ? <Art3D name="clipboard" size={artSize * 0.8} float shadow badge="check" /> : null}
            </View>
            <Txt variant="hero" heading>{t(s.title)}</Txt>
            <Txt variant="body" color="inkMuted" style={styles.body}>{t(s.body)}</Txt>
          </View>
        ))}
      </ScrollView>
      <View style={[styles.bottom, { paddingBottom: Math.max(insets.bottom, space.lg) + space.sm }]}>
        <View style={styles.dots} accessibilityLabel={`${page + 1} / ${SLIDES.length}`}>
          {SLIDES.map((s, k) => <View key={s.title} style={[styles.dot, k === page && styles.dotOn]} />)}
        </View>
        <Button label={last ? t('welcome.getStarted') : t('common.next')} trailingIcon="arrow-forward" onPress={next} testID="welcome-next" />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.canvas },
  flex: { flex: 1 },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: GUTTER, minHeight: 48 },
  skip: { minHeight: 48, minWidth: 48, alignItems: 'center', justifyContent: 'center' },
  slide: { paddingHorizontal: GUTTER + 4, justifyContent: 'center', gap: space.md },
  art: { alignItems: 'center', justifyContent: 'center', marginBottom: space.lg },
  body: { marginTop: space.xs },
  bottom: { paddingHorizontal: GUTTER, gap: space.xl },
  dots: { flexDirection: 'row', gap: space.sm, alignSelf: 'center' },
  dot: { width: 8, height: 8, borderRadius: radius.pill, backgroundColor: colors.lineStrong },
  dotOn: { width: 24, backgroundColor: colors.navy },
});
