// A link that leads nowhere (an old notification, a mistyped deep link) lands here instead of the framework's page.
import { StyleSheet, View } from 'react-native';
import { Art3D } from '../illustrations/Art3D';
import { useI18n } from '../i18n/I18n';
import { resetTo } from '../navigation';
import { space } from '../theme/tokens';
import { Button, Screen, Txt } from '../ui';

export default function NotFound() {
  const { t } = useI18n();
  return (
    <Screen testID="not-found" footer={<Button label={t('confirmed.home')} icon="home" onPress={() => resetTo('/')} testID="not-found-home" />}>
      <View style={styles.center}>
        <Art3D name="no_results" size={120} float shadow />
        <Txt variant="title1" heading align="center">{t('error.notFound')}</Txt>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', gap: space.lg, paddingVertical: space.xxl },
});
