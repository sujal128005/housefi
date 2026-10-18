// "My Housefi ID": the signed-in technician's digital ID card (read-only, screen-capture protected).
import { useI18n } from '../../i18n/I18n';
import { useBackend, useQuery } from '../../services/ServicesProvider';
import { useTechSession } from '../../state/AppState';
import { IdCardPage } from '../../ui/TechIdentity';

export default function MyHousefiId() {
  const { t } = useI18n();
  const backend = useBackend();
  const session = useTechSession();
  const query = useQuery(() => backend.tech.idCard(session.token), [backend, session.token]);
  return <IdCardPage title={t('id.myTitle')} testID="tech-id-card" query={query} viewer="self" />;
}
