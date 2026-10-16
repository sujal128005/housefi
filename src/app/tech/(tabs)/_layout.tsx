// Technician tabs: Home (today and the next action), Jobs, Earnings, Profile. Only for verified technicians.
import { Redirect } from 'expo-router';
import { Tabs } from 'expo-router/js-tabs';
import { StyleSheet } from 'react-native';
import { useI18n } from '../../../i18n/I18n';
import { useAppState } from '../../../state/AppState';
import { fontFamily } from '../../../theme/fonts';
import { colors } from '../../../theme/tokens';
import { Icon, type IconName } from '../../../ui';

const ICONS: Record<string, readonly [IconName, IconName]> = {
  home: ['home', 'home-outline'],
  jobs: ['briefcase', 'briefcase-outline'],
  earnings: ['wallet', 'wallet-outline'],
  profile: ['person-circle', 'person-circle-outline'],
};

export default function TechTabsLayout() {
  const { t, locale } = useI18n();
  const { techSession, prefs } = useAppState();
  if (!techSession || prefs.role !== 'TECHNICIAN' || techSession.profile.verification !== 'APPROVED') return <Redirect href="/" />;
  return (
    <Tabs
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarActiveTintColor: colors.navy,
        tabBarInactiveTintColor: colors.inkSubtle,
        tabBarStyle: styles.bar,
        tabBarLabelStyle: { fontFamily: fontFamily('semibold', locale), fontSize: locale === 'te' ? 11 : 12 },
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
  bar: { backgroundColor: colors.surface, borderTopColor: colors.line, paddingTop: 4 },
});
