// Interface choice: customer or technician. One app, two interfaces; the choice is remembered and can be switched
// from Account.
import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { HouseArt } from '../illustrations/Scenes';
import { Mascot } from '../illustrations/Mascot';
import { useI18n } from '../i18n/I18n';
import { resetTo } from '../navigation';
import { useAppState, type Role } from '../state/AppState';
import { colors, radius, shadow, space } from '../theme/tokens';
import { Header, Icon, Screen, Tap, Txt } from '../ui';

export default function RoleChoice() {
  const { t } = useI18n();
  const { setRole, session } = useAppState();

  const choose = (r: Role) => {
    setRole(r);
    if (r === 'TECHNICIAN') resetTo('/technician');
    else if (session) resetTo(session.customer.name ? '/home' : '/auth/name');
    else router.push('/auth/phone');
  };

  return (
    <Screen testID="role" wash="sky" header={<Header back={router.canGoBack()} demo={false} />}>
      <Txt variant="title1" heading>{t('role.title')}</Txt>
      <RoleCard testID="role-customer" title={t('role.customer.title')} body={t('role.customer.body')} onPress={() => choose('CUSTOMER')} tint={colors.blueTint}
        art={<HouseArt size={150} />} />
      <RoleCard testID="role-technician" title={t('role.technician.title')} body={t('role.technician.body')} onPress={() => choose('TECHNICIAN')} tint="#FFF1E3"
        art={<Mascot pose="toolbox" size={120} />} />
    </Screen>
  );
}

function RoleCard({ title, body, art, onPress, tint, testID }: {
  readonly title: string;
  readonly body: string;
  readonly art: React.ReactNode;
  readonly onPress: () => void;
  readonly tint: string;
  readonly testID: string;
}) {
  return (
    <Tap testID={testID} onPress={onPress} haptic style={styles.card} accessibilityLabel={`${title}. ${body}`} scale={0.98}>
      <View style={[styles.art, { backgroundColor: tint }]}>{art}</View>
      <View style={styles.row}>
        <View style={styles.text}>
          <Txt variant="title2">{title}</Txt>
          <Txt variant="callout" color="inkMuted">{body}</Txt>
        </View>
        <View style={styles.go}>
          <Icon name="arrow-forward" size={22} color="onNavy" />
        </View>
      </View>
    </Tap>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.surface, borderRadius: radius.xxl, overflow: 'hidden', borderWidth: 1, borderColor: colors.line, ...shadow.card },
  art: { height: 150, alignItems: 'center', justifyContent: 'flex-end', paddingTop: space.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.lg },
  text: { flex: 1, gap: 2 },
  go: { width: 48, height: 48, borderRadius: 24, backgroundColor: colors.navy, alignItems: 'center', justifyContent: 'center' },
});
