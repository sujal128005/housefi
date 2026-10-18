import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Animated, Modal, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useI18n } from '../i18n/I18n';
import { colors, GUTTER, radius, shadow, space } from '../theme/tokens';
import { Button, type ButtonVariant } from './Button';
import { Icon, type IconName } from './Icon';
import { Txt } from './Txt';

/** Bottom sheet: slides up over a dimmed backdrop; tapping the backdrop or Android back closes it. */
export function Sheet({ visible, onClose, children, testID }: { readonly visible: boolean; readonly onClose: () => void; readonly children: ReactNode; readonly testID?: string }) {
  const insets = useSafeAreaInsets();
  const y = useRef(new Animated.Value(400)).current;
  useEffect(() => {
    if (visible) {
      y.setValue(400);
      Animated.spring(y, { toValue: 0, useNativeDriver: true, speed: 18, bounciness: 3 }).start();
    }
  }, [visible, y]);
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close" />
        <Animated.View testID={testID} style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, space.lg) + space.sm, transform: [{ translateY: y }] }]}>
          <View style={styles.grabber} />
          {children}
        </Animated.View>
      </View>
    </Modal>
  );
}

export interface ConfirmProps {
  readonly visible: boolean;
  readonly title: string;
  readonly body?: string;
  readonly icon?: IconName;
  readonly confirmLabel: string;
  readonly confirmVariant?: ButtonVariant;
  readonly cancelLabel?: string;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
  readonly busy?: boolean;
  readonly children?: ReactNode;
}

export function ConfirmSheet({ visible, title, body, icon, confirmLabel, confirmVariant = 'primary', cancelLabel, onConfirm, onCancel, busy, children }: ConfirmProps) {
  const { t } = useI18n();
  return (
    <Sheet visible={visible} onClose={onCancel} testID="confirm-sheet">
      {icon ? (
        <View style={[styles.sheetIcon, confirmVariant === 'danger' && { backgroundColor: colors.dangerTint }]}>
          <Icon name={icon} size={28} color={confirmVariant === 'danger' ? 'danger' : 'blue'} />
        </View>
      ) : null}
      <Txt variant="title2" heading>{title}</Txt>
      {body ? <Txt variant="body" color="inkMuted">{body}</Txt> : null}
      {children}
      <View style={styles.actions}>
        <Button label={confirmLabel} variant={confirmVariant} onPress={onConfirm} loading={busy} testID="confirm-yes" />
        <Button label={cancelLabel ?? t('common.cancel')} variant="outline" onPress={onCancel} disabled={busy} testID="confirm-no" />
      </View>
    </Sheet>
  );
}

/** "Not available in demo" explainer, used by every control whose real behaviour needs the backend. */
export function NotInDemoSheet({ visible, onClose, title }: { readonly visible: boolean; readonly onClose: () => void; readonly title?: string }) {
  const { t } = useI18n();
  return (
    <Sheet visible={visible} onClose={onClose} testID="not-in-demo">
      <View style={[styles.sheetIcon, { backgroundColor: colors.demoTint }]}>
        <Icon name="flask" size={28} color="demo" />
      </View>
      <Txt variant="title2" heading>{title ?? t('common.notInDemo')}</Txt>
      {title ? <Txt variant="bodyStrong" color="demo">{t('common.notInDemo')}</Txt> : null}
      <Txt variant="body" color="inkMuted">{t('common.notInDemoBody')}</Txt>
      <Button label={t('common.ok')} onPress={onClose} testID="not-in-demo-ok" />
    </Sheet>
  );
}

// ---------- toast ----------

interface ToastValue {
  readonly show: (message: string, icon?: IconName) => void;
}

const ToastCtx = createContext<ToastValue | null>(null);

export function ToastProvider({ children }: { readonly children: ReactNode }) {
  const insets = useSafeAreaInsets();
  const [msg, setMsg] = useState<{ text: string; icon: IconName } | null>(null);
  const v = useRef(new Animated.Value(0)).current;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = useCallback((text: string, icon: IconName = 'checkmark-circle') => {
    if (timer.current) clearTimeout(timer.current);
    setMsg({ text, icon });
    Animated.spring(v, { toValue: 1, useNativeDriver: true, speed: 20, bounciness: 4 }).start();
    timer.current = setTimeout(() => {
      Animated.timing(v, { toValue: 0, duration: 200, useNativeDriver: true }).start(() => setMsg(null));
    }, 2600);
  }, [v]);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const value = useMemo(() => ({ show }), [show]);
  return (
    <ToastCtx.Provider value={value}>
      {children}
      {msg ? (
        <Animated.View
          pointerEvents="none"
          accessibilityLiveRegion="polite"
          testID="toast"
          style={[styles.toast, { bottom: insets.bottom + 96, opacity: v, transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [20, 0] }) }] }]}
        >
          <Icon name={msg.icon} size={20} color="onNavy" />
          <Txt variant="callout" color="onNavy" style={styles.flex}>{msg.text}</Txt>
        </Animated.View>
      ) : null}
    </ToastCtx.Provider>
  );
}

export function useToast(): ToastValue {
  const v = useContext(ToastCtx);
  if (!v) throw new Error('ToastProvider missing');
  return v;
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  backdrop: { flex: 1, backgroundColor: colors.overlay, justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: radius.xxl, borderTopRightRadius: radius.xxl, paddingHorizontal: GUTTER, paddingTop: space.sm, gap: space.md, ...shadow.raised },
  grabber: { alignSelf: 'center', width: 40, height: 5, borderRadius: 3, backgroundColor: colors.lineStrong, marginBottom: space.sm },
  sheetIcon: { width: 56, height: 56, borderRadius: 18, backgroundColor: colors.blueTint, alignItems: 'center', justifyContent: 'center' },
  actions: { gap: space.sm, marginTop: space.sm },
  toast: { position: 'absolute', left: GUTTER, right: GUTTER, flexDirection: 'row', alignItems: 'center', gap: space.sm, backgroundColor: colors.ink, borderRadius: radius.md, paddingHorizontal: space.lg, paddingVertical: space.md, ...shadow.raised },
});
