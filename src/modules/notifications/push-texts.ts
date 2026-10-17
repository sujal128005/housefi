// What a push notification says on the lock screen. The in-app inbox is written by the app itself from `kind` +
// `params` ("notif.<kind>"); a push is shown by the phone before the app runs, so its text comes from here, in the
// account's language. Telugu wording to be reviewed by the team (QUESTIONS.md).
import type { Locale, NotificationKind } from '@prisma/client';
import type { NoticeParams } from './notifier';

interface Text {
  readonly title: string;
  readonly body: string;
}

type Texts = Readonly<Record<NotificationKind, Text>>;

const EN: Texts = {
  TECH_ASSIGNED: { title: 'Technician assigned', body: 'A verified technician accepted booking {code}.' },
  TECH_ON_THE_WAY: { title: 'Technician on the way', body: 'Arriving in about {etaMin} min for {code}.' },
  TECH_ARRIVED: { title: 'Technician has arrived', body: 'Share your start code with the technician to begin {code}.' },
  QUOTE_READY: { title: 'Repair quote ready', body: '₹{amount} for {code}. Review and approve it in the app.' },
  EXTRA_QUOTE: { title: 'Extra work suggested', body: '₹{amount} more for {code}. Approve or decline it in the app.' },
  PAYMENT_DUE: { title: 'Repair done, payment due', body: 'Pay ₹{amount} for {code}.' },
  BOOKING_COMPLETED: { title: 'Booking completed', body: 'Thank you! {code} is complete. Rate your technician in the app.' },
  BOOKING_CANCELLED: { title: 'Booking cancelled', body: '{code} was cancelled.' },
  NO_TECHNICIAN: { title: 'No technician available', body: 'We could not find a technician for {code}. Choose another time or cancel in the app.' },
  JOB_OFFER: { title: 'New job nearby', body: '₹{earning} for the visit, more for the repair. Accept it quickly.' },
  QUOTE_APPROVED: { title: 'Quote approved', body: 'The customer approved ₹{amount} for {code}. Start the repair.' },
  QUOTE_REVISION: { title: 'New price requested', body: 'The customer asked for a revised quote for {code}.' },
  QUOTE_DECLINED: { title: 'Quote declined', body: 'The customer declined the quote for {code}. You still earn the visit share.' },
  EXTRA_APPROVED: { title: 'Extra work approved', body: '₹{amount} added to {code}.' },
  EXTRA_DECLINED: { title: 'Extra work declined', body: 'Continue the approved repair for {code}.' },
  PAYMENT_RECEIVED: { title: 'Payment received', body: '₹{amount} received for {code}.' },
  JOB_CANCELLED: { title: 'Job cancelled', body: '{code} is no longer assigned to you.' },
  PROFILE_APPROVED: { title: 'Profile approved', body: 'You can go online and receive jobs.' },
  PROFILE_NEEDS_CORRECTION: { title: 'Profile needs changes', body: 'Open the app to see what to correct.' },
};

const TE: Texts = {
  TECH_ASSIGNED: { title: 'టెక్నీషియన్ కేటాయించబడ్డారు', body: 'బుకింగ్ {code} ను ధృవీకరించిన టెక్నీషియన్ అంగీకరించారు.' },
  TECH_ON_THE_WAY: { title: 'టెక్నీషియన్ బయలుదేరారు', body: '{code} కోసం సుమారు {etaMin} నిమిషాల్లో చేరుకుంటారు.' },
  TECH_ARRIVED: { title: 'టెక్నీషియన్ వచ్చారు', body: '{code} ప్రారంభించడానికి మీ స్టార్ట్ కోడ్‌ను టెక్నీషియన్‌కు చెప్పండి.' },
  QUOTE_READY: { title: 'రిపేర్ కొటేషన్ సిద్ధం', body: '{code} కోసం ₹{amount}. యాప్‌లో చూసి ఆమోదించండి.' },
  EXTRA_QUOTE: { title: 'అదనపు పని సూచన', body: '{code} కోసం మరో ₹{amount}. యాప్‌లో ఆమోదించండి లేదా తిరస్కరించండి.' },
  PAYMENT_DUE: { title: 'రిపేర్ పూర్తైంది, చెల్లింపు చేయండి', body: '{code} కోసం ₹{amount} చెల్లించండి.' },
  BOOKING_COMPLETED: { title: 'బుకింగ్ పూర్తైంది', body: 'ధన్యవాదాలు! {code} పూర్తైంది. యాప్‌లో మీ టెక్నీషియన్‌కు రేటింగ్ ఇవ్వండి.' },
  BOOKING_CANCELLED: { title: 'బుకింగ్ రద్దైంది', body: '{code} రద్దు చేయబడింది.' },
  NO_TECHNICIAN: { title: 'టెక్నీషియన్ దొరకలేదు', body: '{code} కోసం టెక్నీషియన్ దొరకలేదు. యాప్‌లో వేరే సమయం ఎంచుకోండి లేదా రద్దు చేయండి.' },
  JOB_OFFER: { title: 'దగ్గరలో కొత్త పని', body: 'విజిట్‌కు ₹{earning}, రిపేర్‌కు అదనం. త్వరగా అంగీకరించండి.' },
  QUOTE_APPROVED: { title: 'కొటేషన్ ఆమోదించబడింది', body: '{code} కోసం ₹{amount} కస్టమర్ ఆమోదించారు. రిపేర్ ప్రారంభించండి.' },
  QUOTE_REVISION: { title: 'కొత్త ధర అడిగారు', body: '{code} కోసం కస్టమర్ మార్చిన కొటేషన్ అడిగారు.' },
  QUOTE_DECLINED: { title: 'కొటేషన్ తిరస్కరించబడింది', body: '{code} కొటేషన్‌ను కస్టమర్ తిరస్కరించారు. విజిట్ వాటా మీకు వస్తుంది.' },
  EXTRA_APPROVED: { title: 'అదనపు పని ఆమోదించబడింది', body: '{code} కు ₹{amount} జోడించబడింది.' },
  EXTRA_DECLINED: { title: 'అదనపు పని తిరస్కరించబడింది', body: '{code} కోసం ఆమోదించిన రిపేర్ కొనసాగించండి.' },
  PAYMENT_RECEIVED: { title: 'చెల్లింపు అందింది', body: '{code} కోసం ₹{amount} అందింది.' },
  JOB_CANCELLED: { title: 'పని రద్దైంది', body: '{code} ఇకపై మీకు కేటాయించబడలేదు.' },
  PROFILE_APPROVED: { title: 'ప్రొఫైల్ ఆమోదించబడింది', body: 'మీరు ఆన్‌లైన్‌కు వెళ్లి పనులు పొందవచ్చు.' },
  PROFILE_NEEDS_CORRECTION: { title: 'ప్రొఫైల్‌లో మార్పులు అవసరం', body: 'ఏమి సరిచేయాలో యాప్‌లో చూడండి.' },
};

/** Used when a value the main text needs is missing (no location yet, so no ETA). */
const FALLBACK: Partial<Record<Locale, Partial<Record<NotificationKind, Text>>>> = {
  en: { TECH_ON_THE_WAY: { title: EN.TECH_ON_THE_WAY.title, body: 'Your technician has started the trip for {code}.' } },
  te: { TECH_ON_THE_WAY: { title: TE.TECH_ON_THE_WAY.title, body: '{code} కోసం మీ టెక్నీషియన్ బయలుదేరారు.' } },
};

const TEXTS: Readonly<Record<Locale, Texts>> = { en: EN, te: TE };

const fill = (template: string, params: NoticeParams): string | null => {
  let missing = false;
  const out = template.replace(/\{(\w+)\}/g, (_, key: string) => {
    const v = params[key];
    if (v === undefined) missing = true;
    return String(v ?? '');
  });
  return missing ? null : out;
};

/** The lock-screen title and body for a notification, in `locale`. */
export function pushText(kind: NotificationKind, locale: Locale, params: NoticeParams): Text {
  for (const text of [TEXTS[locale][kind], FALLBACK[locale]?.[kind]]) {
    if (!text) continue;
    const body = fill(text.body, params);
    if (body !== null) return { title: text.title, body };
  }
  // A notice built without a value its text needs: still say what happened, without the detail.
  return { title: TEXTS[locale][kind].title, body: '' };
}
