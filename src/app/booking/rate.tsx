// Rate the visit: "Were you satisfied?" Yes / No first, then stars, quick tags and an optional comment.
// A "No" or a low rating offers help right away.
import { router, useLocalSearchParams } from 'expo-router';
import { useRef, useState } from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import { Art3D } from '../../illustrations/Art3D';
import { useI18n, type StringKey } from '../../i18n/I18n';
import { useBackend, useQuery } from '../../services/ServicesProvider';
import { useSession } from '../../state/AppState';
import { colors, radius, space } from '../../theme/tokens';
import { Banner, Button, Chip, ErrorBanner, Field, Header, Icon, Screen, Tap, Txt, useToast } from '../../ui';
import { feedback } from '../../services/feedback';

const TAGS: readonly StringKey[] = ['rate.tag.onTime', 'rate.tag.polite', 'rate.tag.clean', 'rate.tag.fair', 'rate.tag.explained', 'rate.tag.fixed'];
const LABELS: readonly StringKey[] = ['rate.l1', 'rate.l2', 'rate.l3', 'rate.l4', 'rate.l5'];

export default function Rate() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, l } = useI18n();
  const backend = useBackend();
  const session = useSession();
  const toast = useToast();
  const q = useQuery(() => backend.bookings.get(session.token, id), [backend, session.token, id]);
  const [satisfied, setSatisfied] = useState<boolean | null>(null);
  const [stars, setStars] = useState(0);
  const [tags, setTags] = useState<string[]>([]);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const bounce = useRef([0, 1, 2, 3, 4].map(() => new Animated.Value(1))).current;
  const tech = q.data?.technician;

  const answer = (yes: boolean) => {
    setSatisfied(yes);
    if (stars === 0) pick(yes ? 5 : 2);
  };

  const pick = (n: number) => {
    setStars(n);
    bounce.slice(0, n).forEach((v, i) => Animated.sequence([
      Animated.delay(i * 40),
      Animated.spring(v, { toValue: 1.25, useNativeDriver: true, speed: 30 }),
      Animated.spring(v, { toValue: 1, useNativeDriver: true, speed: 20 }),
    ]).start());
  };

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await backend.bookings.rate(session.token, id, { satisfied: satisfied ?? stars >= 3, stars, tags: tags.map((k) => k.replace('rate.tag.', '')), comment: comment.trim() });
      feedback('success');
      toast.show(t('rate.thanks'), 'heart');
      router.back();
    } catch (e) {
      feedback('error');
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen testID="rate" wash="peach" header={<Header title={t('rate.title')} />}
      footer={<Button label={t('rate.submit')} onPress={() => void submit()} disabled={stars === 0 || satisfied === null} loading={busy} testID="rate-submit" />}>
      <View style={styles.head}>
        <View style={styles.avatar}><Art3D name={tech?.gender === 'F' ? 'tech_woman' : 'tech_man'} size={96} /></View>
        <Txt variant="title2" align="center" heading>{t('rate.heading', { name: tech ? l(tech.name) : '' })}</Txt>
      </View>
      <Txt variant="title3" align="center" heading>{t('rate.satisfied')}</Txt>
      <View style={styles.yesNo}>
        <Tap onPress={() => answer(true)} style={[styles.choice, satisfied === true && styles.choiceYes]} haptic accessibilityRole="radio"
          accessibilityState={{ selected: satisfied === true }} accessibilityLabel={t('rate.yes')} testID="rate-yes">
          <Art3D name="thumbs_up" size={64} />
          <Txt variant="title3" color={satisfied === true ? 'success' : 'ink'}>{t('rate.yes')}</Txt>
        </Tap>
        <Tap onPress={() => answer(false)} style={[styles.choice, satisfied === false && styles.choiceNo]} haptic accessibilityRole="radio"
          accessibilityState={{ selected: satisfied === false }} accessibilityLabel={t('rate.no')} testID="rate-no">
          <View style={styles.flip}><Art3D name="thumbs_up" size={64} /></View>
          <Txt variant="title3" color={satisfied === false ? 'danger' : 'ink'}>{t('rate.no')}</Txt>
        </Tap>
      </View>
      <View style={styles.stars} accessibilityRole="adjustable" accessibilityLabel={t('rate.starsLabel', { n: stars })}>
        {[1, 2, 3, 4, 5].map((n) => (
          <Tap key={n} onPress={() => pick(n)} accessibilityLabel={`${n}`} testID={`star-${n}`} scale={0.9} haptic>
            <Animated.View style={{ transform: [{ scale: bounce[n - 1] ?? 1 }] }}>
              <Icon name={n <= stars ? 'star' : 'star-outline'} size={46} color={n <= stars ? 'yellow' : 'lineStrong'} />
            </Animated.View>
          </Tap>
        ))}
      </View>
      {stars > 0 ? <Txt variant="bodyStrong" align="center" color="navy">{t(LABELS[stars - 1] ?? 'rate.l5')}</Txt> : null}
      <Txt variant="label" color="inkMuted">{t('rate.what')}</Txt>
      <View style={styles.chips}>
        {TAGS.map((k) => <Chip key={k} label={t(k)} selected={tags.includes(k)} onPress={() => setTags((a) => (a.includes(k) ? a.filter((x) => x !== k) : [...a, k]))} testID={`tag-${k}`} />)}
      </View>
      <Field label={t('rate.comment')} optional value={comment} onChangeText={setComment} multiline maxLength={300} placeholder={t('rate.commentPlaceholder')} testID="rate-comment" textAlignVertical="top" />
      {satisfied === false || (stars > 0 && stars <= 2) ? <Banner tone="warning" text={t('rate.sorry')} action={t('hub.help')} onAction={() => router.push('/support')} /> : null}
      <ErrorBanner error={error} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  head: { alignItems: 'center', gap: space.sm },
  avatar: { width: 120, height: 120, borderRadius: 60, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  stars: { flexDirection: 'row', justifyContent: 'center', gap: space.sm },
  yesNo: { flexDirection: 'row', gap: space.md },
  choice: { flex: 1, alignItems: 'center', gap: space.xs, paddingVertical: space.lg, borderRadius: radius.xl, backgroundColor: colors.surface, borderWidth: 2, borderColor: colors.line },
  choiceYes: { borderColor: colors.success, backgroundColor: colors.successTint },
  choiceNo: { borderColor: colors.danger, backgroundColor: colors.dangerTint },
  flip: { transform: [{ rotate: '180deg' }] },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
});
