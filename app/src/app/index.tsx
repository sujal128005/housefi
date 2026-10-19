// Launch gate: sends people to the first step they have not finished, in the customer or the technician interface.
import { Redirect } from 'expo-router';
import { techHref } from '../domain/techReview';
import { useAppState } from '../state/AppState';
import { useNow } from '../state/useNow';

export default function Index() {
  const { prefs, session, techSession } = useAppState();
  const now = useNow();
  if (!prefs.welcomeSeen) return <Redirect href="/welcome" />;
  if (!prefs.locale) return <Redirect href="/language" />;
  if (!prefs.role) return <Redirect href="/role" />;
  if (prefs.role === 'TECHNICIAN') {
    if (!techSession) return <Redirect href="/auth/phone" />;
    // Details, then the Aadhaar scan, then the check (an approval shows from the promised time), then the app.
    return <Redirect href={techHref(techSession.profile, now)} />;
  }
  if (!session) return <Redirect href="/auth/phone" />;
  if (!session.customer.name) return <Redirect href="/auth/name" />;
  return <Redirect href="/home" />;
}
