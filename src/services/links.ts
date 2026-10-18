// Housefi on the web. The app links to the website from Account, Profile, Help and Terms & privacy.
import { Linking } from 'react-native';

export const WEBSITE_URL = 'https://housefi.tech/';

/**
 * The final terms and privacy policy, once they are published on the website. Until then (null) the app shows its
 * own draft. The website's /terms and /privacy pages today cover only the website itself, so they are not used here.
 */
export const PUBLISHED_TERMS_URL: string | null = null;
export const PUBLISHED_PRIVACY_URL: string | null = null;

/** Opens a web page in the phone's browser; a phone without a browser simply stays where it is. */
export function openWeb(url: string = WEBSITE_URL): void {
  void Linking.openURL(url).catch(() => undefined);
}
