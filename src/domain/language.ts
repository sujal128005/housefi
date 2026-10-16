// "Detect language from location": which language people mostly speak in a state / city. Only English and Telugu are
// in the app today; others are recognised and shown as "coming soon".
import type { Locale } from '../i18n/format';

export type RegionLanguage = 'te' | 'hi' | 'ta' | 'kn' | 'ml' | 'mr' | 'bn' | 'gu' | 'pa' | 'or' | 'en';

/** Native name (with the English name) shown to the person. */
export const LANGUAGE_NAMES: Readonly<Record<RegionLanguage, string>> = {
  te: 'తెలుగు (Telugu)', hi: 'हिन्दी (Hindi)', ta: 'தமிழ் (Tamil)', kn: 'ಕನ್ನಡ (Kannada)', ml: 'മലയാളം (Malayalam)', mr: 'मराठी (Marathi)',
  bn: 'বাংলা (Bengali)', gu: 'ગુજરાતી (Gujarati)', pa: 'ਪੰਜਾਬੀ (Punjabi)', or: 'ଓଡ଼ିଆ (Odia)', en: 'English',
};

const BY_REGION: readonly (readonly [RegionLanguage, readonly string[]])[] = [
  ['te', ['andhra pradesh', 'telangana', 'kurnool', 'hyderabad', 'vijayawada', 'visakhapatnam', 'tirupati', 'guntur', 'warangal', 'nellore', 'kakinada', 'anantapur', 'kadapa', 'karimnagar', 'nizamabad']],
  ['hi', ['delhi', 'uttar pradesh', 'madhya pradesh', 'rajasthan', 'bihar', 'haryana', 'jharkhand', 'chhattisgarh', 'uttarakhand', 'himachal pradesh', 'chandigarh', 'lucknow', 'jaipur', 'bhopal', 'patna', 'noida', 'gurugram', 'gurgaon']],
  ['ta', ['tamil nadu', 'puducherry', 'chennai', 'coimbatore', 'madurai']],
  ['kn', ['karnataka', 'bengaluru', 'bangalore', 'mysuru', 'mysore', 'hubli']],
  ['ml', ['kerala', 'kochi', 'thiruvananthapuram', 'kozhikode']],
  ['mr', ['maharashtra', 'mumbai', 'pune', 'nagpur', 'nashik']],
  ['bn', ['west bengal', 'kolkata', 'tripura']],
  ['gu', ['gujarat', 'ahmedabad', 'surat', 'vadodara']],
  ['pa', ['punjab', 'amritsar', 'ludhiana']],
  ['or', ['odisha', 'orissa', 'bhubaneswar', 'cuttack']],
];

/** Locales the app can show today. */
export const SUPPORTED_LOCALES: readonly Locale[] = ['en', 'te'];

export interface LanguageGuess {
  readonly language: RegionLanguage;
  /** The app already has this language. */
  readonly supported: boolean;
}

/** Best guess of the local language from a city and state name (English names as the phone reports them). */
export function languageForPlace(city: string, region: string): LanguageGuess {
  const hay = `${city} ${region}`.toLowerCase();
  const hit = BY_REGION.find(([, names]) => names.some((n) => hay.includes(n)));
  const language = hit ? hit[0] : 'en';
  return { language, supported: (SUPPORTED_LOCALES as readonly string[]).includes(language) };
}
