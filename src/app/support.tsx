// AI support chat (demo assistant): quick replies, typing indicator, knows the live booking; hands over to a person
// ("Call customer care") when it cannot help. The real AI and calling arrive with the backend.
import { useEffect, useRef, useState } from 'react';
import { Animated, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { Art3D } from '../illustrations/Art3D';
import { useI18n } from '../i18n/I18n';
import type { ChatReply } from '../services/api';
import { useBackend } from '../services/ServicesProvider';
import { useSession } from '../state/AppState';
import { fontFamily } from '../theme/fonts';
import { colors, GUTTER, radius, space } from '../theme/tokens';
import { Banner, Button, Header, Icon, NotInDemoSheet, Pill, Screen, Tap, Txt } from '../ui';
import { Appear } from '../ui/motion';

interface Msg {
  readonly id: number;
  readonly from: 'me' | 'ai';
  readonly text: string;
}

export default function Support() {
  const { t, locale } = useI18n();
  const backend = useBackend();
  const session = useSession();
  const [msgs, setMsgs] = useState<Msg[]>([{ id: 0, from: 'ai', text: t('support.hello') }]);
  const [chips, setChips] = useState<readonly string[]>([t('support.c.track'), t('support.c.price'), t('support.c.cancel'), t('support.c.human')]);
  const [offerHuman, setOfferHuman] = useState(false);
  const [typing, setTyping] = useState(false);
  const [text, setText] = useState('');
  const [call, setCall] = useState(false);
  const scroll = useRef<ScrollView>(null);
  const nextId = useRef(1);

  useEffect(() => {
    setTimeout(() => scroll.current?.scrollToEnd({ animated: true }), 60);
  }, [msgs, typing]);

  const send = async (raw: string) => {
    const m = raw.trim();
    if (!m || typing) return;
    setText('');
    setMsgs((a) => [...a, { id: nextId.current++, from: 'me', text: m }]);
    setTyping(true);
    let r: ChatReply;
    try {
      r = await backend.ai.chat(session.token, m, locale);
    } catch {
      r = { text: t('support.offline'), suggestions: [], offerHuman: true };
    }
    setTyping(false);
    setMsgs((a) => [...a, { id: nextId.current++, from: 'ai', text: r.text }]);
    setChips(r.suggestions);
    if (r.offerHuman) setOfferHuman(true);
  };

  return (
    <Screen
      testID="support"
      scroll={false}
      header={<Header title={t('support.title')} />}
      contentStyle={styles.noPad}
      footer={
        <>
        {chips.length > 0 ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips} keyboardShouldPersistTaps="handled">
            {chips.map((c) => (
              <Tap key={c} onPress={() => void send(c)} style={styles.chip} accessibilityLabel={c} testID={`chip-${c}`}>
                <Txt variant="label" color="onBlueTint">{c}</Txt>
              </Tap>
            ))}
          </ScrollView>
        ) : null}
        <View style={styles.inputRow}>
          <TextInput value={text} onChangeText={setText} placeholder={t('support.placeholder')} placeholderTextColor={colors.inkSubtle} testID="support-input"
            style={[styles.input, { fontFamily: fontFamily('medium', locale) }]} onSubmitEditing={() => void send(text)} returnKeyType="send" accessibilityLabel={t('support.placeholder')} />
          <Tap onPress={() => void send(text)} disabled={!text.trim() || typing} style={[styles.send, (!text.trim() || typing) && styles.sendOff]} accessibilityLabel={t('support.send')} testID="support-send">
            <Icon name="send" size={20} color="onNavy" />
          </Tap>
        </View>
        <Banner tone="demo" text={t('support.demo')} />
        </>
      }
    >
      <ScrollView ref={scroll} style={styles.flex} contentContainerStyle={styles.list} keyboardShouldPersistTaps="handled">
        <View style={styles.botHead}>
          <Art3D name="robot" size={72} float />
          <Txt variant="title3">{t('support.name')}</Txt>
          <Pill label={t('support.demoAi')} tone="demo" icon="sparkles" />
        </View>
        {msgs.map((m) => (
          <Appear key={m.id} from={8} style={[styles.bubbleRow, m.from === 'me' && styles.mine]}>
            {m.from === 'ai' ? <Art3D name="robot" size={28} /> : null}
            <View style={[styles.bubble, m.from === 'me' ? styles.bubbleMe : styles.bubbleAi]} testID={m.from === 'ai' ? 'ai-msg' : 'my-msg'}>
              <Txt variant="callout" color={m.from === 'me' ? 'onNavy' : 'ink'}>{m.text}</Txt>
            </View>
          </Appear>
        ))}
        {typing ? <Typing /> : null}
        {offerHuman ? (
          <Appear>
            <View style={styles.human}>
              <Art3D name="call" size={40} />
              <View style={styles.flex}>
                <Txt variant="bodyStrong">{t('support.humanTitle')}</Txt>
                <Txt variant="footnote" color="inkMuted">{t('support.humanSub')}</Txt>
              </View>
              <Button label={t('support.call')} icon="call" size="sm" onPress={() => setCall(true)} testID="support-call" />
            </View>
          </Appear>
        ) : null}
      </ScrollView>
      <NotInDemoSheet visible={call} title={t('support.call')} onClose={() => setCall(false)} />
    </Screen>
  );
}

function Typing() {
  const dots = useRef([0, 1, 2].map(() => new Animated.Value(0.3))).current;
  useEffect(() => {
    const loop = Animated.loop(Animated.stagger(150, dots.map((d) => Animated.sequence([
      Animated.timing(d, { toValue: 1, duration: 300, useNativeDriver: true }),
      Animated.timing(d, { toValue: 0.3, duration: 300, useNativeDriver: true }),
    ]))));
    loop.start();
    return () => loop.stop();
  }, [dots]);
  return (
    <View style={styles.bubbleRow} testID="ai-typing">
      <Art3D name="robot" size={28} />
      <View style={[styles.bubble, styles.bubbleAi, styles.typing]}>
        {dots.map((d, i) => <Animated.View key={i} style={[styles.dot, { opacity: d }]} />)}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  noPad: { paddingHorizontal: 0, paddingTop: 0 },
  list: { paddingHorizontal: GUTTER, paddingVertical: space.md, gap: space.md },
  botHead: { alignItems: 'center', gap: space.xs, paddingBottom: space.sm },
  bubbleRow: { flexDirection: 'row', alignItems: 'flex-end', gap: space.sm, maxWidth: '88%' },
  mine: { alignSelf: 'flex-end', flexDirection: 'row-reverse' },
  bubble: { paddingHorizontal: space.md, paddingVertical: space.sm + 2, borderRadius: radius.lg, flexShrink: 1 },
  bubbleAi: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, borderBottomLeftRadius: 6 },
  bubbleMe: { backgroundColor: colors.navy, borderBottomRightRadius: 6 },
  typing: { flexDirection: 'row', gap: 5, paddingVertical: space.md },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.inkMuted },
  human: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md, borderRadius: radius.lg, backgroundColor: colors.successTint },
  chips: { gap: space.sm },
  chip: { minHeight: 40, justifyContent: 'center', paddingHorizontal: space.md, borderRadius: radius.pill, backgroundColor: colors.blueTint },
  inputRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  input: { flex: 1, minHeight: 50, paddingHorizontal: space.lg, borderRadius: radius.pill, backgroundColor: colors.surfaceMuted, color: colors.ink, fontSize: 16 },
  send: { width: 50, height: 50, borderRadius: 25, backgroundColor: colors.navy, alignItems: 'center', justifyContent: 'center' },
  sendOff: { opacity: 0.4 },
});
