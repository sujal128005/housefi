// Technician interface placeholder until Path 3. Honest about what is missing, with a way back.
import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { Mascot } from '../illustrations/Mascot';
import { useI18n } from '../i18n/I18n';
import { useAppState } from '../state/AppState';
import { space } from '../theme/tokens';
import { Button, Header, Screen, Txt } from '../ui';

export default function TechnicianSoon() {
  const { t } = useI18n();
  const { setRole } = useAppState();
  return (
    <Screen
      testID="technician-soon"
      wash="peach"
      header={<Header back={false} />}
      footer={
        <>
          <Button label={t('tech.soon.switch')} testID="tech-switch" onPress={() => {
            setRole(null);
            router.replace('/role');
          }} />
          <Button label={t('tech.soon.language')} variant="outline" icon="language" onPress={() => router.push({ pathname: '/language', params: { from: 'account' } })} />
        </>
      }
    >
      <View style={styles.art}><Mascot pose="toolbox" size={200} /></View>
      <Txt variant="title1" align="center" heading>{t('tech.soon.title')}</Txt>
      <Txt variant="body" color="inkMuted" align="center">{t('tech.soon.body')}</Txt>
    </Screen>
  );
}

const styles = StyleSheet.create({
  art: { alignItems: 'center', marginTop: space.xl },
});
