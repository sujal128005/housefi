// Launch gate: sends people to the first step they have not finished, in the customer or the technician interface.
import { Redirect } from 'expo-router';
import { useAppState } from '../state/AppState';

export default function Index() {
  const { prefs, session, techSession } = useAppState();
  if (!prefs.welcomeSeen) return <Redirect href="/welcome" />;
  if (!prefs.locale) return <Redirect href="/language" />;
  if (!prefs.role) return <Redirect href="/role" />;
  if (prefs.role === 'TECHNICIAN') {
    if (!techSession) return <Redirect href="/auth/phone" />;
    const v = techSession.profile.verification;
    if (v === null) return <Redirect href="/tech/setup" />;
    if (v !== 'APPROVED') return <Redirect href="/tech/verification" />;
    return <Redirect href="/tech/home" />;
  }
  if (!session) return <Redirect href="/auth/phone" />;
  if (!session.customer.name) return <Redirect href="/auth/name" />;
  return <Redirect href="/home" />;
}
