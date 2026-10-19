import { router, type Href } from 'expo-router';

/** Clears the stack and shows `href` as the only screen (after sign-in, after onboarding, on sign-out). */
export function resetTo(href: Href): void {
  if (router.canDismiss()) router.dismissAll();
  router.replace(href);
}

/**
 * Where "back" goes when there is no screen before: choosing customer or technician. Sign-in and registration
 * screens are often the first screen shown (the launch gate sends people straight there, and sign-in clears the
 * stack), and the launch gate itself would send them right back to the same screen.
 */
export const START_HREF = '/role';

/** Back to the previous screen, or to the customer / technician choice when this screen was shown first. */
export function backOrStart(): void {
  if (router.canGoBack()) router.back();
  else router.replace(START_HREF);
}
