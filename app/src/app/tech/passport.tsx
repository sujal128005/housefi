// "My Skill Passport": the technician's record, proven trades, courses and certificates, and the switch that shows it on
// the public page their Housefi ID QR opens. Off until they switch it on; sharing sends that page's link.
import { router } from 'expo-router';
import { useState } from 'react';
import { Share, StyleSheet, Switch, View } from 'react-native';
import type { MyPassport } from '../../domain/types';
import { useI18n } from '../../i18n/I18n';
import { useBackend, useQuery } from '../../services/ServicesProvider';
import { useTechSession } from '../../state/AppState';
import { colors, space } from '../../theme/tokens';
import { Banner, Button, Card, ErrorBanner, ErrorView, Header, Screen, Skeleton, Txt } from '../../ui';
import { SkillPassportView } from '../../ui/SkillPassport';

export default function MySkillPassport() {
  const { t } = useI18n();
  const backend = useBackend();
  const session = useTechSession();
  const q = useQuery(() => backend.tech.passport(session.token), [backend, session.token]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  // The answer to the last switch (newer than the loaded one).
  const [saved, setSaved] = useState<MyPassport | null>(null);
  const mine = saved ?? q.data;

  const toggle = async (on: boolean) => {
    setBusy(true);
    setError(null);
    try {
      setSaved(await backend.tech.setPassportPublic(session.token, on));
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen testID="tech-passport" header={<Header title={t('passport.title')} onBack={() => router.back()} />}
      footer={mine ? (
        <Button label={t('passport.share')} icon="share-social" disabled={!mine.public} testID="passport-share"
          onPress={() => void Share.share({ message: t('passport.shareText', { link: mine.link }) })} />
      ) : undefined}>
      {q.loading && !mine ? <Skeleton style={styles.skel} /> : null}
      {q.error && !mine ? <ErrorView error={q.error} onRetry={q.reload} /> : null}
      {mine ? (
        <>
          <Txt variant="callout" color="inkMuted">{t('passport.intro')}</Txt>
          <Card style={styles.switchCard}>
            <View style={styles.flex}>
              <Txt variant="bodyStrong">{t('passport.show')}</Txt>
              <Txt variant="footnote" color="inkMuted">{t('passport.showSub')}</Txt>
            </View>
            <Switch value={mine.public} disabled={busy} onValueChange={(on) => void toggle(on)} testID="passport-switch"
              trackColor={{ true: colors.blue, false: colors.lineStrong }} thumbColor={colors.surface} accessibilityLabel={t('passport.show')} />
          </Card>
          {error ? <ErrorBanner error={error} /> : null}
          <Banner tone={mine.public ? 'success' : 'info'} icon={mine.public ? 'eye' : 'eye-off'}
            text={mine.public ? t('passport.isPublic') : t('passport.isPrivate')} testID={mine.public ? 'passport-public' : 'passport-private'} />
          <SkillPassportView passport={mine.passport} testID="passport-view" />
          <Txt variant="footnote" color="inkMuted">{t('passport.grow')}</Txt>
        </>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  skel: { height: 420, borderRadius: 24 },
  switchCard: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  flex: { flex: 1 },
});
