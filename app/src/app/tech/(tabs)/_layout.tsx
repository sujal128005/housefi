// Technician tabs: Home (today and the next action), Jobs, Earnings, Profile. Only for verified technicians.
import { Redirect } from 'expo-router';
import { Tabs } from 'expo-router/js-tabs';
import { StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { approvalShown } from '../../../domain/techReview';
import { useI18n } from '../../../i18n/I18n';
import { useAppState } from '../../../state/AppState';
import { useNow } from '../../../state/useNow';
import { useLocationReporter } from '../../../services/locationReporter';
import { fontFamily } from '../../../theme/fonts';
import { colors } from '../../../theme/tokens';
import { Icon, type IconName } from '../../../ui';
import { ScreenErrorBoundary } from '../../../ui/Recovery';

const ICONS: Record<string, readonly [IconName, IconName]> = {
  home: ['home', 'home-outline'],
  jobs: ['briefcase', 'briefcase-outline'],
  earnings: ['wallet', 'wallet-outline'],
  profile: ['person-circle', 'person-circle-outline'],
};

export default function TechTabsLayout() {
  const insets = useSafeAreaInsets();
  const { t, locale } = useI18n();
  const { techSession, prefs } = useAppState();
  const now = useNow(techSession?.profile.reviewBy);
  // While online, the phone's position is used to offer nearby jobs.
  useLocationReporter(techSession?.token ?? '', !!techSession?.profile.online);
  if (!techSession || prefs.role !== 'TECHNICIAN' || !approvalShown(techSession.profile, now)) return <Redirect href="/" />;
  return (
    <Tabs
      screenLayout={({ children }) => <ScreenErrorBoundary>{children}</ScreenErrorBoundary>}
      screenOptions={({ route }) => ({
        headerShown: false,
        // A short cross-fade between tabs, as in super.money.
        animation: 'fade',
        tabBarActiveTintColor: colors.navy,
        tabBarInactiveTintColor: colors.inkSubtle,
        // Tall enough for the item's padding, the icon and the label (fixed line height) on every phone: without a bottom
        // safe area (older iPhones, Android with buttons) the default height cut the labels in half.
        tabBarStyle: [styles.bar, { height: 62 + insets.bottom, paddingBottom: insets.bottom > 0 ? insets.bottom : 4 }],
        tabBarLabelStyle: { fontFamily: fontFamily('semibold', locale), fontSize: locale === 'te' ? 11 : 12, lineHeight: locale === 'te' ? 16 : 15 },
        tabBarIcon: ({ focused }) => {
          const pair = ICONS[route.name] ?? ICONS.home;
          return <Icon name={(focused ? pair?.[0] : pair?.[1]) ?? 'home'} size={24} color={focused ? 'navy' : 'inkSubtle'} />;
        },
        sceneStyle: { backgroundColor: colors.canvas },
      })}
    >
      <Tabs.Screen name="home" options={{ title: t('tab.home'), tabBarButtonTestID: 'ttab-home' }} />
      <Tabs.Screen name="jobs" options={{ title: t('ttab.jobs'), tabBarButtonTestID: 'ttab-jobs' }} />
      <Tabs.Screen name="earnings" options={{ title: t('ttab.earnings'), tabBarButtonTestID: 'ttab-earnings' }} />
      <Tabs.Screen name="profile" options={{ title: t('ttab.profile'), tabBarButtonTestID: 'ttab-profile' }} />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  bar: { backgroundColor: colors.surface, borderTopColor: colors.line, paddingTop: 2 },
});
