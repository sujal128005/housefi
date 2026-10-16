// The customer's view of the technician assigned to their booking: the same read-only, capture-protected ID card.
// The backend answers only for the customer's own booking with an assigned technician.
import { useLocalSearchParams } from 'expo-router';
import { useI18n } from '../../i18n/I18n';
import { useBackend, useQuery } from '../../services/ServicesProvider';
import { useSession } from '../../state/AppState';
import { IdCardPage } from '../../ui/TechIdentity';

export default function TechnicianIdScreen() {
  const { t } = useI18n();
  const backend = useBackend();
  const session = useSession();
  const { id } = useLocalSearchParams<{ id: string }>();
  const query = useQuery(() => backend.bookings.technicianCard(session.token, id ?? ''), [backend, session.token, id]);
  return <IdCardPage title={t('id.custTitle')} testID="booking-tech-id" query={query} viewer="customer" />;
}
