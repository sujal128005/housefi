import { router, type Href } from 'expo-router';

/** Clears the stack and shows `href` as the only screen (after sign-in, after onboarding, on sign-out). */
export function resetTo(href: Href): void {
  if (router.canDismiss()) router.dismissAll();
  router.replace(href);
}
