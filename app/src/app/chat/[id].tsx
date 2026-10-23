// Chat between a customer and the technician of their booking, from assignment until the job is done: words and
// photos (instructions, the problem, the gate). The customer sees the technician's photo, name and Technician ID (tap:
// their ID card, and back to the chat); the technician sees the customer's first name and a location button (the
// address given when booking, with directions). After the job the chat is read-only; it can be cleared then, and
// clears itself a day later. ?as=tech opens it from the technician app.
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { Image, KeyboardAvoidingView, Modal, Pressable, ScrollView, StyleSheet, TextInput, View, type ScrollViewInstance } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { AssignedTechnician, Job } from '../../domain/types';
import { formatClock, formatDate } from '../../i18n/format';
import { useI18n } from '../../i18n/I18n';
import { isApiError, type Chat } from '../../services/api';
import { pickPhoto } from '../../services/device';
import { feedback } from '../../services/feedback';
import { useBackend } from '../../services/ServicesProvider';
import { useAppState } from '../../state/AppState';
import { keepIfSame, startPolling } from '../../state/polling';
import { colors, radius, space } from '../../theme/tokens';
import { BackButton, Banner, Button, Card, ErrorBanner, Icon, Tap, Txt, useToast } from '../../ui';
import { TechPhoto } from '../../ui/TechIdentity';
import { addressLine } from '../../ui/present';
import { openDirections } from '../../ui/TechParts';

export default function ChatScreen() {
  const { id, as } = useLocalSearchParams<{ id: string; as?: string }>();
  const asTech = as === 'tech';
  const { t, l, locale } = useI18n();
  const backend = useBackend();
  const toast = useToast();
  const insets = useSafeAreaInsets();
  const { session, techSession } = useAppState();
  const token = (asTech ? techSession?.token : session?.token) ?? '';
  const api = asTech ? backend.tech.chat : backend.chat;
  const [chat, setChat] = useState<Chat | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [tech, setTech] = useState<AssignedTechnician | null>(null);
  const [job, setJob] = useState<Job | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [viewing, setViewing] = useState<string | null>(null);
  const [place, setPlace] = useState(false);
  const scroller = useRef<ScrollViewInstance>(null);

  useFocusEffect(useCallback(() => {
    if (!token || !id) return undefined;
    let alive = true;
    // Who is on the other side: the technician's card for the customer, the job (name, address) for the technician.
    // Asked again with each refresh until it arrives, so a failed first try does not leave the header blank.
    let known = false;
    const who = () => {
      if (known) return;
      if (asTech) void backend.tech.job(token, id).then((j) => { known = true; if (alive) setJob(j); }).catch(() => undefined);
      else {
        void backend.bookings.get(token, id).then((b) => {
          // No technician yet (still being matched): ask again later.
          known = !!b.technician;
          if (alive) setTech(b.technician);
        }).catch(() => undefined);
      }
    };
    who();
    const stop = startPolling(() => api.get(token, id).then((c) => {
      if (!alive) return;
      who();
      setChat(keepIfSame<Chat | null>(c));
      setError(null);
    }, (e: unknown) => {
      if (alive) setError(e);
    }), 3000);
    return () => {
      alive = false;
      stop();
    };
  }, [token, id, asTech, api, backend]));

  const send = async (photoUri?: string) => {
    const words = text.trim();
    if (!chat?.open || busy || (!words && !photoUri)) return;
    setBusy(true);
    try {
      setChat(await api.send(token, id, { text: words, ...(photoUri ? { photoUri } : {}) }));
      setText('');
      feedback('send');
      setTimeout(() => scroller.current?.scrollToEnd({ animated: true }), 50);
    } catch (e) {
      feedback('error');
      toast.show(isApiError(e, 'CONFLICT') ? t('chat.closed') : t('chat.failed'), 'alert-circle');
    } finally {
      setBusy(false);
    }
  };

  const addPhoto = async (source: 'camera' | 'gallery') => {
    const r = await pickPhoto(source);
    if (r.ok) await send(r.uri);
    else if (r.reason === 'DENIED') toast.show(t('photos.denied'), 'camera');
  };

  const clear = async () => {
    setBusy(true);
    try {
      await api.clear(token, id);
      feedback('success');
      toast.show(t('chat.cleared'), 'trash');
      router.back();
    } catch {
      toast.show(t('chat.failed'), 'alert-circle');
    } finally {
      setBusy(false);
    }
  };

  const name = asTech ? (job?.customerName ?? '') : tech ? l(tech.name) : '';
  const clearsAt = chat?.clearsAt ? new Date(chat.clearsAt) : null;

  return (
    <View style={styles.root} testID="chat">
      <KeyboardAvoidingView style={styles.flex} behavior="padding">
        {/* header: who is on the other side */}
        <View style={[styles.header, { paddingTop: insets.top + space.sm }]}>
          <BackButton />
          {asTech ? (
            <View style={styles.avatar}><Icon name="person" size={22} color="navy" /></View>
          ) : tech ? (
            <Tap onPress={() => router.push({ pathname: '/booking/technician', params: { id } })} accessibilityLabel={t('id.tapToView')} testID="chat-tech-photo">
              <TechPhoto photo={tech.photo} gender={tech.gender} size={40} />
            </Tap>
          ) : <View style={styles.avatar} />}
          <View style={styles.flex}>
            <Txt variant="bodyStrong" numberOfLines={1} testID="chat-name">{name}</Txt>
            {!asTech && tech?.techCode ? (
              <Txt variant="caption" color="blue" lang="en" onPress={() => router.push({ pathname: '/booking/technician', params: { id } })}
                accessibilityRole="link" testID="chat-tech-id">{tech.techCode}</Txt>
            ) : null}
          </View>
          {asTech && job ? (
            <Tap onPress={() => setPlace(true)} style={styles.headerBtn} accessibilityLabel={t('chat.location')} testID="chat-location">
              <Icon name="location" size={22} color="navy" />
            </Tap>
          ) : null}
        </View>

        {/* messages, oldest first, newest at the bottom */}
        <ScrollView ref={scroller} style={styles.flex} contentContainerStyle={styles.list}
          onContentSizeChange={() => scroller.current?.scrollToEnd({ animated: false })} keyboardShouldPersistTaps="handled">
          {chat && chat.messages.length === 0 ? <Txt variant="footnote" color="inkMuted" align="center" style={styles.hint}>{asTech ? t('chat.emptyTech') : t('chat.empty')}</Txt> : null}
          {chat?.messages.map((m) => (
            <View key={m.id} style={[styles.bubble, m.from === 'ME' ? styles.mine : styles.theirs]} testID={`chat-msg-${m.from}`}>
              {m.photo ? (
                <Pressable onPress={() => setViewing(m.photo)} accessibilityRole="imagebutton" accessibilityLabel={t('chat.photo')}>
                  <Image source={{ uri: m.photo }} style={styles.photo} resizeMode="cover" />
                </Pressable>
              ) : null}
              {m.text ? <Txt variant="body" color={m.from === 'ME' ? 'onNavy' : 'ink'}>{m.text}</Txt> : null}
              <Txt variant="caption" color={m.from === 'ME' ? 'onNavy' : 'inkMuted'} style={styles.time}>{formatClock(new Date(m.at), locale)}</Txt>
            </View>
          ))}
          <ErrorBanner error={chat ? null : error} />
        </ScrollView>

        {/* composer while the job is on; afterwards, clearing */}
        <View style={[styles.composer, { paddingBottom: insets.bottom + space.sm }]}>
          {chat?.open ? (
            <View style={styles.row}>
              <Tap onPress={() => void addPhoto('camera')} disabled={busy} style={styles.tool} accessibilityLabel={t('photos.camera')} testID="chat-camera">
                <Icon name="camera" size={22} color="navy" />
              </Tap>
              <Tap onPress={() => void addPhoto('gallery')} disabled={busy} style={styles.tool} accessibilityLabel={t('photos.gallery')} testID="chat-gallery">
                <Icon name="images" size={22} color="navy" />
              </Tap>
              <TextInput value={text} onChangeText={setText} placeholder={t('chat.placeholder')} placeholderTextColor={colors.inkSubtle}
                style={styles.input} multiline maxLength={1000} testID="chat-input" accessibilityLabel={t('chat.placeholder')} />
              <Tap onPress={() => void send()} disabled={busy || !text.trim()} style={[styles.send, (busy || !text.trim()) && styles.sendOff]}
                accessibilityLabel={t('chat.send')} testID="chat-send" haptic>
                <Icon name="send" size={20} color="onNavy" />
              </Tap>
            </View>
          ) : chat?.clearable ? (
            <View style={styles.closed}>
              <Banner tone="info" icon="lock-closed" text={clearsAt ? t('chat.doneClears', { date: formatDate(clearsAt, locale), time: formatClock(clearsAt, locale) }) : t('chat.done')} />
              <Button label={t('chat.clear')} icon="trash" variant="danger" size="md" onPress={() => void clear()} loading={busy} testID="chat-clear" />
            </View>
          ) : null}
        </View>
      </KeyboardAvoidingView>

      {/* a photo, full screen */}
      <Modal visible={viewing !== null} transparent animationType="fade" onRequestClose={() => setViewing(null)}>
        <Pressable style={styles.viewer} onPress={() => setViewing(null)} accessibilityLabel={t('common.close')}>
          {viewing ? <Image source={{ uri: viewing }} style={styles.full} resizeMode="contain" /> : null}
        </Pressable>
      </Modal>

      {/* the technician: where the customer is (the address they gave when booking) */}
      <Modal visible={place} transparent animationType="slide" onRequestClose={() => setPlace(false)}>
        <Pressable style={styles.sheetBack} onPress={() => setPlace(false)} />
        {job ? (
          <Card style={[styles.sheet, { paddingBottom: insets.bottom + space.lg }]} testID="chat-place">
            <Txt variant="title3" heading>{t('chat.location')}</Txt>
            <View style={styles.row}>
              <Icon name="location" size={22} color="navy" />
              <Txt variant="body" style={styles.flex}>{`${addressLine(job.address)}, ${job.address.city} ${job.address.pincode}`}</Txt>
            </View>
            {job.address.landmark ? <Txt variant="footnote" color="inkMuted">{job.address.landmark}</Txt> : null}
            <Button label={t('tj.openDirections')} icon="navigate" onPress={() => {
              void openDirections(job.address).then((ok) => {
                if (!ok) toast.show(t('tj.mapsFailed'), 'map');
              });
            }} testID="chat-directions" />
            <Button label={t('common.close')} variant="ghost" size="md" onPress={() => setPlace(false)} />
          </Card>
        ) : null}
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.canvas },
  flex: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.lg, paddingBottom: space.sm, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: colors.line, backgroundColor: colors.surface },
  avatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.blueTint, alignItems: 'center', justifyContent: 'center' },
  headerBtn: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.blueTint },
  list: { padding: space.lg, gap: space.sm },
  hint: { marginTop: space.xl },
  bubble: { maxWidth: '82%', borderRadius: radius.lg, paddingHorizontal: space.md, paddingVertical: space.sm, gap: 4 },
  mine: { alignSelf: 'flex-end', backgroundColor: colors.navy, borderBottomRightRadius: 4 },
  theirs: { alignSelf: 'flex-start', backgroundColor: colors.surface, borderBottomLeftRadius: 4, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.line },
  photo: { width: 200, height: 200, borderRadius: radius.md },
  time: { alignSelf: 'flex-end', opacity: 0.8 },
  composer: { paddingHorizontal: space.md, paddingTop: space.sm, borderTopWidth: StyleSheet.hairlineWidth, borderColor: colors.line, backgroundColor: colors.surface },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  tool: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  input: { flex: 1, minHeight: 40, maxHeight: 120, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.line, paddingHorizontal: space.md, paddingVertical: space.sm, fontSize: 17, color: colors.ink, backgroundColor: colors.canvas },
  send: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.navy, alignItems: 'center', justifyContent: 'center' },
  sendOff: { opacity: 0.4 },
  closed: { gap: space.sm },
  viewer: { flex: 1, backgroundColor: 'rgba(0,0,0,0.92)', alignItems: 'center', justifyContent: 'center' },
  full: { width: '100%', height: '80%' },
  sheetBack: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)' },
  sheet: { gap: space.md, borderBottomLeftRadius: 0, borderBottomRightRadius: 0 },
});
