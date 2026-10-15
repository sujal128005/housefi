// Launch gate: sends people to the first step they have not finished.
import { Redirect } from 'expo-router';
import { useAppState } from '../state/AppState';

export default function Index() {
  const { prefs, session } = useAppState();
  if (!prefs.welcomeSeen) return <Redirect href="/welcome" />;
  if (!prefs.locale) return <Redirect href="/language" />;
  if (!prefs.role) return <Redirect href="/role" />;
  if (prefs.role === 'TECHNICIAN') return <Redirect href="/technician" />;
  if (!session) return <Redirect href="/auth/phone" />;
  if (!session.customer.name) return <Redirect href="/auth/name" />;
  return <Redirect href="/home" />;
}
