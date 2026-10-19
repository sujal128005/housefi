// The floating chat bubble: while a job's chat is open (or has unread messages), a small round button stays above
// the screens, so the customer or technician can move around the app and come back to the chat in one tap. It shows
// how many messages are unread. Hidden on the chat itself, while signing in, paying, and answering a job offer.
import { router, usePathname } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { chatToOpen } from '../domain/chat';
import { useI18n } from '../i18n/I18n';
import type { ChatSummary } from '../services/api';
import { useBackend } from '../services/ServicesProvider';
import { useAppState } from '../state/AppState';
import { keepIfSame, startPolling } from '../state/polling';
import { colors, shadow } from '../theme/tokens';
import { Icon } from './Icon';
import { Tap } from './Tap';
import { Txt } from './Txt';

/** Where the bubble stays out of the way. */
const HIDDEN = [/^\/chat\//, /^\/auth\//, /^\/welcome/, /^\/language/, /^\/role/, /^\/pay/, /^\/tech\/offer\//, /^\/tech\/setup/, /^\/tech\/aadhaar/, /^\/tech\/verification/, /^\/book\//];

export function ChatBubble() {
  const { t } = useI18n();
  const backend = useBackend();
  const insets = useSafeAreaInsets();
  const pathname = usePathname();
  const { prefs, session, techSession } = useAppState();
  const asTech = prefs.role === 'TECHNICIAN';
  const token = asTech ? (techSession?.profile.verification === 'APPROVED' ? techSession.token : null) : session?.token ?? null;
  const [chats, setChats] = useState<readonly ChatSummary[]>([]);

  useEffect(() => {
    if (!token) {
      setChats([]);
      return undefined;
    }
    let alive = true;
    const api = asTech ? backend.tech.chat : backend.chat;
    const stop = startPolling(() => api.list(token).then((list) => {
      if (alive) setChats(keepIfSame<readonly ChatSummary[]>(list));
    }, () => undefined), 8000);
    return () => {
      alive = false;
      stop();
    };
  }, [token, asTech, backend]);

  const target = chatToOpen(chats);
  if (!token || !target || HIDDEN.some((re) => re.test(pathname))) return null;
  const unread = chats.reduce((n, c) => n + c.unread, 0);
  return (
    <View pointerEvents="box-none" style={[styles.layer, { bottom: insets.bottom + 96 }]}>
      <Tap onPress={() => router.push(asTech ? { pathname: '/chat/[id]', params: { id: target.bookingId, as: 'tech' } } : `/chat/${target.bookingId}`)}
        style={styles.bubble} accessibilityLabel={`${t('chat.bubble')}, ${target.code}`} testID="chat-bubble" haptic scale={0.92}>
        <Icon name="chatbubbles" size={26} color="onNavy" />
        {unread > 0 ? (
          <View style={styles.badge} testID="chat-bubble-unread">
            <Txt variant="caption" color="onNavy" weight="bold">{unread > 9 ? '9+' : String(unread)}</Txt>
          </View>
        ) : null}
      </Tap>
    </View>
  );
}

const styles = StyleSheet.create({
  layer: { position: 'absolute', right: 16 },
  bubble: { width: 58, height: 58, borderRadius: 29, backgroundColor: colors.navy, alignItems: 'center', justifyContent: 'center', ...shadow.raised },
  badge: { position: 'absolute', top: -4, right: -4, minWidth: 22, height: 22, borderRadius: 11, paddingHorizontal: 5, backgroundColor: colors.danger, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: colors.surface },
});
