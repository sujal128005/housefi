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
  PAY_REMINDER: { title: 'Pay the visit fee', body: 'Booking {code} is cancelled in {minutes} min unless the visit fee is paid.' },
  BOOKING_REMINDER: { title: 'Visit in about an hour', body: 'Your technician comes for {code} from {startHour}:00. Keep your start code ready.' },
  JOB_REMINDER: { title: 'Job in about an hour', body: '{code} starts at {startHour}:00. Start the trip on time.' },
  BOOKING_TOMORROW: { title: 'Visit tomorrow', body: 'Your technician comes for {code} tomorrow, {startHour}:00 to {endHour}:00.' },
  JOB_TOMORROW: { title: 'Job tomorrow', body: '{code} tomorrow, {startHour}:00 to {endHour}:00. Check your schedule in Jobs.' },
  JOB_DAY_PLAN: { title: "Today's jobs", body: '{count} scheduled today, the first at {startHour}:00. See your schedule in Jobs.' },
  CHAT_MESSAGE: { title: 'New message', body: 'About {code}. Open the chat to read and reply.' },
  QUOTE_REMINDER: { title: 'Your technician is waiting', body: 'Please answer the quote for {code} in the app.' },
  RATE_REMINDER: { title: 'How was the visit?', body: 'Rate your technician for {code}. It takes a few seconds.' },
  PROFILE_SUSPENDED: { title: 'Account on hold', body: 'You will not get jobs for now. Contact your Housefi coordinator.' },
  PROFILE_REINSTATED: { title: 'Account active again', body: 'You can go online and receive jobs.' },
  PROFILE_REJECTED: { title: 'Registration not approved', body: 'Contact Housefi support for details.' },
  SUPPORT_REPLY: { title: 'Housefi team replied', body: 'Open Help to read the reply.' },
  ANNOUNCEMENT: { title: '{title}', body: '{body}' },
  APPRENTICE_REQUEST: { title: 'Someone wants to learn from you', body: '{name} asked to be your apprentice. Open Apprentice mode to answer.' },
  APPRENTICE_ACCEPTED: { title: 'You have a mentor', body: '{name} accepted you as their apprentice.' },
  TRAINEE_JOB: { title: 'Join a job as apprentice', body: 'Your mentor added you to job {code}. Open Apprentice mode for the time and place.' },
  TRAINEE_REMOVED: { title: 'Apprentice job changed', body: 'You are no longer on job {code}.' },
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
  PAY_REMINDER: { title: 'విజిట్ ఫీజు చెల్లించండి', body: 'విజిట్ ఫీజు చెల్లించకపోతే {minutes} నిమిషాల్లో బుకింగ్ {code} రద్దవుతుంది.' },
  BOOKING_REMINDER: { title: 'సుమారు గంటలో విజిట్', body: '{code} కోసం {startHour}:00 నుండి టెక్నీషియన్ వస్తారు. మీ స్టార్ట్ కోడ్ సిద్ధంగా ఉంచండి.' },
  JOB_REMINDER: { title: 'సుమారు గంటలో పని', body: '{code} {startHour}:00 కు మొదలవుతుంది. సమయానికి బయలుదేరండి.' },
  BOOKING_TOMORROW: { title: 'రేపు విజిట్', body: '{code} కోసం రేపు {startHour}:00 నుండి {endHour}:00 మధ్య టెక్నీషియన్ వస్తారు.' },
  JOB_TOMORROW: { title: 'రేపు పని', body: '{code} రేపు {startHour}:00 నుండి {endHour}:00. Jobs లో మీ షెడ్యూల్ చూడండి.' },
  JOB_DAY_PLAN: { title: 'ఈరోజు పనులు', body: 'ఈరోజు {count} పనులు, మొదటిది {startHour}:00 కు. Jobs లో మీ షెడ్యూల్ చూడండి.' },
  CHAT_MESSAGE: { title: 'కొత్త సందేశం', body: '{code} గురించి. చదవడానికి, జవాబు ఇవ్వడానికి చాట్ తెరవండి.' },
  QUOTE_REMINDER: { title: 'టెక్నీషియన్ ఎదురుచూస్తున్నారు', body: '{code} కొటేషన్‌కు యాప్‌లో సమాధానం ఇవ్వండి.' },
  RATE_REMINDER: { title: 'విజిట్ ఎలా ఉంది?', body: '{code} కోసం మీ టెక్నీషియన్‌కు రేటింగ్ ఇవ్వండి.' },
  PROFILE_SUSPENDED: { title: 'ఖాతా నిలిపివేయబడింది', body: 'ప్రస్తుతం పనులు రావు. మీ Housefi కోఆర్డినేటర్‌ను సంప్రదించండి.' },
  PROFILE_REINSTATED: { title: 'ఖాతా మళ్లీ యాక్టివ్', body: 'మీరు ఆన్‌లైన్‌కు వెళ్లి పనులు పొందవచ్చు.' },
  PROFILE_REJECTED: { title: 'రిజిస్ట్రేషన్ ఆమోదించబడలేదు', body: 'వివరాల కోసం Housefi సపోర్ట్‌ను సంప్రదించండి.' },
  SUPPORT_REPLY: { title: 'Housefi టీమ్ జవాబిచ్చింది', body: 'జవాబు చదవడానికి సహాయం తెరవండి.' },
  ANNOUNCEMENT: { title: '{titleTe}', body: '{bodyTe}' },
  APPRENTICE_REQUEST: { title: 'మీ దగ్గర నేర్చుకోవాలనుకుంటున్నారు', body: '{name} మీ అప్రెంటిస్‌గా ఉండాలని అడిగారు. జవాబు ఇవ్వడానికి అప్రెంటిస్ మోడ్ తెరవండి.' },
  APPRENTICE_ACCEPTED: { title: 'మీకు మెంటర్ దొరికారు', body: '{name} మిమ్మల్ని అప్రెంటిస్‌గా ఒప్పుకున్నారు.' },
  TRAINEE_JOB: { title: 'అప్రెంటిస్‌గా పనికి రండి', body: 'మీ మెంటర్ మిమ్మల్ని {code} పనికి జోడించారు. సమయం, చోటు కోసం అప్రెంటిస్ మోడ్ తెరవండి.' },
  TRAINEE_REMOVED: { title: 'అప్రెంటిస్ పని మారింది', body: 'మీరు ఇక {code} పనిలో లేరు.' },
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
    // Titles are fixed words, except announcements (HQ's own title).
    if (body !== null) return { title: fill(text.title, params) ?? text.title, body };
  }
  // A notice built without a value its text needs: still say what happened, without the detail.
  return { title: TEXTS[locale][kind].title, body: '' };
}
