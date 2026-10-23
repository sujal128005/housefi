// Help chat: the Housefi assistant first (quick replies, typing indicator, knows the live booking). When it can't help
// or the person asks for a person, it asks what it is about (topic, booking, what happened) and hands over to a live
// chat with the Housefi team, who answer from Housefi HQ. "Call customer care" stays available throughout.
import { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, Linking, ScrollView, StyleSheet, TextInput, View, type ScrollViewInstance } from 'react-native';
import { Art3D } from '../illustrations/Art3D';
import { useI18n } from '../i18n/I18n';
import type { ChatAction, ChatReply, SupportConversation, SupportTopic } from '../services/api';
import { feedback } from '../services/feedback';
import { formatRupees } from '../i18n/format';
import { useBackend } from '../services/ServicesProvider';
import { useSession } from '../state/AppState';
import { startPolling } from '../state/polling';
import { fontFamily } from '../theme/fonts';
import { colors, GUTTER, radius, space } from '../theme/tokens';
import { Banner, Button, Header, Icon, Pill, Screen, Tap, Txt } from '../ui';
import { useCareCall } from '../ui/useMaskedCall';
import { Appear } from '../ui/motion';

interface Msg {
  readonly id: number;
  readonly from: 'me' | 'ai';
  readonly text: string;
  readonly links?: readonly { readonly label: string; readonly url: string }[];
  /** A cancellation to confirm; `done` once answered (the card then stays as a record). */
  readonly action?: ChatAction | null;
  readonly done?: 'CANCELLED' | 'KEPT';
}

const TOPICS: readonly SupportTopic[] = ['BOOKING', 'PAYMENT', 'TECHNICIAN', 'APP', 'OTHER'];
const ABOUT_BOOKING: readonly SupportTopic[] = ['BOOKING', 'PAYMENT', 'TECHNICIAN'];

/** Talking to the assistant, answering its handover questions, or live with the team. */
type Mode =
  | { readonly kind: 'ai' }
  | { readonly kind: 'intake'; readonly step: 'topic' | 'booking' | 'text'; readonly topic: SupportTopic | null; readonly bookingId: string | null }
  | { readonly kind: 'live'; readonly conversation: SupportConversation };

export default function Support() {
  const { t, locale } = useI18n();
  const backend = useBackend();
  const session = useSession();
  const [msgs, setMsgs] = useState<Msg[]>([{ id: 0, from: 'ai', text: t('support.hello') }]);
  const [chips, setChips] = useState<readonly string[]>([t('support.c.track'), t('support.c.price'), t('support.c.cancel'), t('support.c.human')]);
  const [offerHuman, setOfferHuman] = useState(false);
  const [typing, setTyping] = useState(false);
  const [text, setText] = useState('');
  const [mode, setMode] = useState<Mode>({ kind: 'ai' });
  const [bookingChips, setBookingChips] = useState<readonly { id: string; code: string }[]>([]);
  const [sending, setSending] = useState(false);
  const care = useCareCall(session.token);
  const scroll = useRef<ScrollViewInstance>(null);
  const nextId = useRef(1);

  useEffect(() => {
    setTimeout(() => scroll.current?.scrollToEnd({ animated: true }), 60);
  }, [msgs, typing, mode]);

  // An open conversation with the team (or one it closed today) opens straight away.
  useEffect(() => {
    let alive = true;
    backend.support.conversation(session.token).then((c) => {
      if (alive && c) setMode({ kind: 'live', conversation: c });
    }, () => undefined);
    return () => {
      alive = false;
    };
  }, [backend, session.token]);

  // Live: the team's replies arrive by polling every few seconds while the screen is open.
  const live = mode.kind === 'live' && mode.conversation.state === 'OPEN';
  const refresh = useCallback(async () => {
    const c = await backend.support.conversation(session.token);
    if (c) setMode((m) => (m.kind === 'live' && c.messages.length === m.conversation.messages.length && c.state === m.conversation.state ? m : { kind: 'live', conversation: c }));
  }, [backend, session.token]);
  useEffect(() => (live ? startPolling(refresh, 5000) : undefined), [live, refresh]);

  const say = (text: string) => setMsgs((a) => [...a, { id: nextId.current++, from: 'ai', text }]);
  const mine = (text: string) => setMsgs((a) => [...a, { id: nextId.current++, from: 'me', text }]);

  // ---------- the handover questions ----------

  const startIntake = () => {
    setOfferHuman(false);
    setChips([]);
    say(t('support.q.topic'));
    setMode({ kind: 'intake', step: 'topic', topic: null, bookingId: null });
  };

  const pickTopic = async (topic: SupportTopic) => {
    mine(t(`support.topic.${topic}`));
    if (ABOUT_BOOKING.includes(topic)) {
      const list = await backend.bookings.list(session.token).catch(() => []);
      const recent = list.slice(0, 4).map((b) => ({ id: b.id, code: b.code }));
      if (recent.length > 0) {
        setBookingChips(recent);
        say(t('support.q.booking'));
        setMode({ kind: 'intake', step: 'booking', topic, bookingId: null });
        return;
      }
    }
    say(t('support.q.text'));
    setMode({ kind: 'intake', step: 'text', topic, bookingId: null });
  };

  const pickBooking = (b: { id: string; code: string } | null) => {
    if (mode.kind !== 'intake') return;
    mine(b ? b.code : t('support.notBooking'));
    say(t('support.q.text'));
    setMode({ ...mode, step: 'text', bookingId: b?.id ?? null });
  };

  const handOver = async (words: string) => {
    if (mode.kind !== 'intake' || !mode.topic) return;
    mine(words);
    setTyping(true);
    try {
      const c = await backend.support.startConversation(session.token, { topic: mode.topic, bookingId: mode.bookingId, text: words });
      feedback('success');
      setMode({ kind: 'live', conversation: c });
    } catch {
      feedback('error');
      say(t('support.startFailed'));
      setOfferHuman(true);
      setMode({ kind: 'ai' });
    } finally {
      setTyping(false);
    }
  };

  // ---------- sending ----------

  const send = async (raw: string) => {
    const m = raw.trim();
    if (!m || typing || sending) return;
    setText('');
    if (mode.kind === 'intake' && mode.step === 'text') return handOver(m);
    if (mode.kind === 'live') {
      setSending(true);
      try {
        setMode({ kind: 'live', conversation: await backend.support.sendToTeam(session.token, m) });
      } catch {
        setText(m);
        say(t('support.sendFailed'));
      } finally {
        setSending(false);
      }
      return;
    }
    mine(m);
    setTyping(true);
    let r: ChatReply;
    try {
      r = await backend.ai.chat(session.token, m, locale);
    } catch {
      r = { text: t('support.offline'), suggestions: [], offerHuman: true };
    }
    setTyping(false);
    setMsgs((a) => [...a, { id: nextId.current++, from: 'ai', text: r.text, links: r.links ?? [], action: r.action ?? null }]);
    setChips(r.suggestions);
    if (r.offerHuman) setOfferHuman(true);
  };

  const [acting, setActing] = useState(false);
  const answer = async (msgId: number, action: ChatAction, cancel: boolean) => {
    if (acting) return;
    const mark = (done: 'CANCELLED' | 'KEPT') => setMsgs((a) => a.map((m) => (m.id === msgId ? { ...m, done } : m)));
    if (!cancel) {
      mark('KEPT');
      say(t('support.kept', { code: action.code }));
      return;
    }
    setActing(true);
    try {
      // The usual cancellation: the server checks the booking, the time and the refund again.
      await backend.bookings.cancel(session.token, action.bookingId, action.reason);
      mark('CANCELLED');
      feedback('success');
      say(action.refund > 0 ? t('support.cancelledRefund', { code: action.code, amount: formatRupees(action.refund) }) : t('support.cancelled', { code: action.code }));
      setChips([]);
    } catch {
      feedback('error');
      say(t('support.cancelFailed', { code: action.code }));
      setOfferHuman(true);
    } finally {
      setActing(false);
    }
  };

  const intakeChips: readonly { key: string; label: string; onPress: () => void }[] =
    mode.kind === 'intake' && mode.step === 'topic'
      ? TOPICS.map((x) => ({ key: x, label: t(`support.topic.${x}`), onPress: () => void pickTopic(x) }))
      : mode.kind === 'intake' && mode.step === 'booking'
        ? [...bookingChips.map((b) => ({ key: b.id, label: b.code, onPress: () => pickBooking(b) })), { key: 'none', label: t('support.notBooking'), onPress: () => pickBooking(null) }]
        : [];
  const shownChips = mode.kind === 'ai' ? chips.map((c) => ({ key: c, label: c, onPress: () => void send(c) })) : intakeChips;
  const canType = mode.kind === 'ai' || (mode.kind === 'intake' && mode.step === 'text') || live;
  const closed = mode.kind === 'live' && mode.conversation.state === 'CLOSED';
  const placeholder = live || (mode.kind === 'intake' && mode.step === 'text') ? t('support.teamPlaceholder') : t('support.placeholder');

  return (
    <Screen
      testID="support"
      scroll={false}
      header={<Header title={t('support.title')} />}
      contentStyle={styles.noPad}
      footer={
        <>
        {shownChips.length > 0 ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips} keyboardShouldPersistTaps="handled">
            {shownChips.map((c) => (
              <Tap key={c.key} onPress={c.onPress} style={styles.chip} accessibilityLabel={c.label} testID={`chip-${c.label}`}>
                <Txt variant="label" color="onBlueTint">{c.label}</Txt>
              </Tap>
            ))}
          </ScrollView>
        ) : null}
        {closed ? (
          <Button label={t('support.backToAssistant')} icon="sparkles" variant="secondary" onPress={() => setMode({ kind: 'ai' })} testID="support-back-ai" />
        ) : canType ? (
          <View style={styles.inputRow}>
            <TextInput value={text} onChangeText={setText} placeholder={placeholder} placeholderTextColor={colors.inkSubtle} testID="support-input" maxLength={1000}
              style={[styles.input, { fontFamily: fontFamily('medium', locale) }]} onSubmitEditing={() => void send(text)} returnKeyType="send" accessibilityLabel={placeholder} />
            <Tap onPress={() => void send(text)} disabled={!text.trim() || typing || sending} style={[styles.send, (!text.trim() || typing || sending) && styles.sendOff]} accessibilityLabel={t('support.send')} testID="support-send">
              <Icon name="send" size={20} color="onNavy" />
            </Tap>
          </View>
        ) : null}
        <Banner tone="info" text={mode.kind === 'live' ? t('support.teamNote') : t('support.demo')} />
        </>
      }
    >
      <ScrollView ref={scroll} style={styles.flex} contentContainerStyle={styles.list} keyboardShouldPersistTaps="handled">
        {mode.kind === 'live' ? (
          <LiveConversation conversation={mode.conversation} />
        ) : (
          <>
            <View style={styles.botHead}>
              <Art3D name="robot" size={72} float />
              <Txt variant="title3">{t('support.name')}</Txt>
              <Pill label={t('support.demoAi')} tone="info" icon="sparkles" />
            </View>
            {msgs.map((m) => (
              <Appear key={m.id} from={8} style={[styles.bubbleRow, m.from === 'me' && styles.mine]}>
                {m.from === 'ai' ? <Art3D name="robot" size={28} /> : null}
                <View style={[styles.bubble, m.from === 'me' ? styles.bubbleMe : styles.bubbleAi]} testID={m.from === 'ai' ? 'ai-msg' : 'my-msg'}>
                  <Txt variant="callout" color={m.from === 'me' ? 'onNavy' : 'ink'}>{m.text}</Txt>
                  {m.links?.map((l) => (
                    <Tap key={l.url} onPress={() => void Linking.openURL(l.url).catch(() => undefined)} accessibilityRole="link" accessibilityLabel={l.label} style={styles.link} testID={`ai-link-${l.label}`}>
                      <Icon name={/linkedin\.com/i.test(l.url) ? 'logo-linkedin' : 'globe-outline'} size={18} color="blue" />
                      <Txt variant="label" color="blue">{l.label}</Txt>
                    </Tap>
                  ))}
                  {m.action ? (
                    <View style={styles.confirm} testID="ai-cancel-card">
                      {m.done ? (
                        <Txt variant="footnote" color="inkMuted">{m.done === 'CANCELLED' ? t('support.cardCancelled') : t('support.cardKept')}</Txt>
                      ) : (
                        <View style={styles.confirmRow}>
                          <Button label={t('support.yesCancel')} variant="danger" size="sm" onPress={() => void answer(m.id, m.action!, true)} loading={acting} style={styles.flex} testID="ai-cancel-yes" />
                          <Button label={t('support.keep')} variant="outline" size="sm" onPress={() => void answer(m.id, m.action!, false)} disabled={acting} style={styles.flex} testID="ai-cancel-no" />
                        </View>
                      )}
                    </View>
                  ) : null}
                </View>
              </Appear>
            ))}
          </>
        )}
        {typing ? <Typing /> : null}
        {offerHuman && mode.kind === 'ai' ? (
          <Appear>
            <View style={styles.human}>
              <View style={styles.humanTop}>
                <Art3D name="call" size={40} />
                <View style={styles.flex}>
                  <Txt variant="bodyStrong">{t('support.humanTitle')}</Txt>
                  <Txt variant="footnote" color="inkMuted">{t('support.humanSub')}</Txt>
                </View>
              </View>
              <View style={styles.confirmRow}>
                <Button label={t('support.chatTeam')} icon="chatbubbles" size="sm" onPress={startIntake} style={styles.flex} testID="support-team" />
                <Button label={t('support.call')} icon="call" size="sm" variant="outline" onPress={() => void care.call()} loading={care.calling} style={styles.flex} testID="support-call" />
              </View>
            </View>
          </Appear>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

/** The live conversation with the team: their messages on the left, the person's on the right, notes in the middle. */
function LiveConversation({ conversation }: { readonly conversation: SupportConversation }) {
  const { t } = useI18n();
  return (
    <>
      <View style={styles.botHead}>
        <Art3D name="handshake" size={72} float />
        <Txt variant="title3">{t('support.teamName')}</Txt>
        <Pill label={conversation.state === 'OPEN' ? t('support.live') : t('support.closedNote')} tone={conversation.state === 'OPEN' ? 'success' : 'neutral'} icon={conversation.state === 'OPEN' ? 'radio-button-on' : 'checkmark-circle'} />
      </View>
      <Txt variant="footnote" color="inkMuted" align="center">{t('support.connected')}</Txt>
      {conversation.messages.map((m) =>
        m.from === 'SYSTEM' ? (
          <Txt key={m.id} variant="caption" color="inkMuted" align="center" testID="team-note">{m.text}</Txt>
        ) : (
          <Appear key={m.id} from={8} style={[styles.bubbleRow, m.from === 'ME' && styles.mine]}>
            {m.from === 'HQ' ? <Art3D name="handshake" size={28} /> : null}
            <View style={[styles.bubble, m.from === 'ME' ? styles.bubbleMe : styles.bubbleTeam]} testID={m.from === 'HQ' ? 'team-msg' : 'my-msg'}>
              <Txt variant="callout" color={m.from === 'ME' ? 'onNavy' : 'ink'}>{m.text}</Txt>
            </View>
          </Appear>
        ),
      )}
    </>
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
  link: { flexDirection: 'row', alignItems: 'center', gap: space.xs, paddingVertical: space.xs },
  confirm: { marginTop: space.sm, gap: space.sm },
  confirmRow: { flexDirection: 'row', gap: space.sm },
  list: { paddingHorizontal: GUTTER, paddingVertical: space.md, gap: space.md },
  botHead: { alignItems: 'center', gap: space.xs, paddingBottom: space.sm },
  bubbleRow: { flexDirection: 'row', alignItems: 'flex-end', gap: space.sm, maxWidth: '88%' },
  mine: { alignSelf: 'flex-end', flexDirection: 'row-reverse' },
  bubble: { paddingHorizontal: space.md, paddingVertical: space.sm + 2, borderRadius: radius.lg, flexShrink: 1 },
  bubbleAi: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, borderBottomLeftRadius: 6 },
  bubbleTeam: { backgroundColor: colors.successTint, borderBottomLeftRadius: 6 },
  bubbleMe: { backgroundColor: colors.navy, borderBottomRightRadius: 6 },
  typing: { flexDirection: 'row', gap: 5, paddingVertical: space.md },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.inkMuted },
  human: { gap: space.md, padding: space.md, borderRadius: radius.lg, backgroundColor: colors.successTint },
  humanTop: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  chips: { gap: space.sm },
  chip: { minHeight: 40, justifyContent: 'center', paddingHorizontal: space.md, borderRadius: radius.pill, backgroundColor: colors.blueTint },
  inputRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  input: { flex: 1, minHeight: 50, paddingHorizontal: space.lg, borderRadius: radius.pill, backgroundColor: colors.surfaceMuted, color: colors.ink, fontSize: 16 },
  send: { width: 50, height: 50, borderRadius: 25, backgroundColor: colors.navy, alignItems: 'center', justifyContent: 'center' },
  sendOff: { opacity: 0.4 },
});
