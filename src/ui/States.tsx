import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { useI18n } from '../i18n/I18n';
import { resetTo } from '../navigation';
import { isApiError } from '../services/api';
import { useAppState } from '../state/AppState';
import { colors, radius, space } from '../theme/tokens';
import { Button } from './Button';
import { Icon } from './Icon';
import { Banner } from './Surfaces';
import { Txt } from './Txt';

export function EmptyState({ art, title, body, action, onAction, testID }: {
  readonly art: ReactNode;
  readonly title: string;
  readonly body?: string;
  readonly action?: string;
  readonly onAction?: () => void;
  readonly testID?: string;
}) {
  return (
    <View style={styles.empty} testID={testID}>
      {art}
      <Txt variant="title2" align="center" heading>{title}</Txt>
      {body ? <Txt variant="body" color="inkMuted" align="center">{body}</Txt> : null}
      {action && onAction ? <Button label={action} onPress={onAction} size="md" style={styles.emptyAction} /> : null}
    </View>
  );
}

/** The session ended (expired or signed out elsewhere): sign in again. The booking draft stays in memory. */
function useSignInAgain(): () => void {
  const { prefs, signOut, techSignOut } = useAppState();
  return () => {
    void (prefs.role === 'TECHNICIAN' ? techSignOut() : signOut());
    resetTo('/auth/phone');
  };
}

function SessionEnded({ inline }: { readonly inline?: boolean }) {
  const { t } = useI18n();
  const signIn = useSignInAgain();
  return (
    <View style={inline ? styles.banners : styles.error} testID="session-ended" accessibilityRole="alert">
      <Banner tone="warning" icon="key" text={t('error.session.body')} />
      <Button label={t('error.session.cta')} icon="log-in-outline" onPress={signIn} size="md" testID="session-sign-in" />
    </View>
  );
}

/** Inline error with a retry. Says when the error was simulated from Demo settings. */
export function ErrorView({ error, onRetry, title }: { readonly error: unknown; readonly onRetry: () => void; readonly title?: string }) {
  const { t } = useI18n();
  const network = isApiError(error, 'NETWORK');
  if (isApiError(error, 'UNAUTHENTICATED')) return <SessionEnded />;
  return (
    <View style={styles.error} testID="error-view" accessibilityRole="alert">
      <View style={styles.errorIcon}>
        <Icon name={network ? 'cloud-offline' : 'alert-circle'} size={30} color="danger" />
      </View>
      <Txt variant="title3" align="center">{title ?? (network ? t('error.network.title') : t('error.generic'))}</Txt>
      {network ? <Txt variant="callout" color="inkMuted" align="center">{t('error.network.body')}</Txt> : null}
      {isApiError(error) && error.simulated ? <Banner tone="demo" text={t('error.simulated')} /> : null}
      <Button label={t('common.retry')} icon="refresh" onPress={onRetry} variant="outline" size="md" testID="retry" />
    </View>
  );
}

/** One-line error banner used above a form's submit button. */
export function ErrorBanner({ error }: { readonly error: unknown }) {
  const { t } = useI18n();
  if (!error) return null;
  if (isApiError(error, 'UNAUTHENTICATED')) return <SessionEnded inline />;
  const network = isApiError(error, 'NETWORK');
  const text = network ? `${t('error.network.title')}. ${t('error.network.body')}` : t('error.generic');
  return (
    <View style={styles.banners}>
      <Banner tone="danger" text={text} testID="error-banner" />
      {isApiError(error) && error.simulated ? <Banner tone="demo" text={t('error.simulated')} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  empty: { alignItems: 'center', gap: space.md, paddingVertical: space.x3, paddingHorizontal: space.lg },
  emptyAction: { alignSelf: 'stretch', marginTop: space.sm },
  error: { alignItems: 'stretch', gap: space.md, padding: space.xl, backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.line },
  errorIcon: { alignSelf: 'center', width: 60, height: 60, borderRadius: 20, backgroundColor: colors.dangerTint, alignItems: 'center', justifyContent: 'center' },
  banners: { gap: space.sm },
});
