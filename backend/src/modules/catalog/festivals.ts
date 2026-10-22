// The festive greeting on the home screens (customer and technician apps): which festival, in which days, and what it
// says. Changing it needs no new app: edit this list and update the server. The app draws the look for each `theme`
// (lights, kites, moon, colours, leaves, flag, flowers); a theme it does not know yet gets a plain festive look.
//
// Lunar festivals move every year and the moon decides Ramzan and Bakrid: the windows start a few days early and end a
// day or two late, so a day's shift never leaves the greeting out. Dates in India time, both days included.
import type { CategoryId } from '@prisma/client';

interface Localized {
  readonly en: string;
  readonly te: string;
}

export type FestiveTheme = 'lights' | 'kites' | 'moon' | 'colours' | 'leaves' | 'flag' | 'flowers';

export interface Festival {
  readonly id: string;
  readonly theme: FestiveTheme;
  /** YYYY-MM-DD, India time. */
  readonly from: string;
  readonly to: string;
  /** "Happy Diwali". The app adds the person's first name. */
  readonly title: Localized;
  /** For customers: a line tied to the home, with a service to book (categoryId) when one fits. */
  readonly body: Localized;
  readonly categoryId: CategoryId | null;
  readonly cta: Localized | null;
  /**
   * The festival's coupon code (e.g. DIWALI26), made in Housefi HQ > Coupons. The customer home shows it ("26% off,
   * use DIWALI26") only while that coupon exists, is switched on, is within its dates and is not used up.
   */
  readonly coupon: string | null;
  /** For technicians. */
  readonly techBody: Localized;
}

const DIWALI: Omit<Festival, 'id' | 'from' | 'to' | 'coupon'> = {
  theme: 'lights',
  title: { en: 'Happy Diwali', te: 'దీపావళి శుభాకాంక్షలు' },
  body: { en: 'May every corner of your home glow. Get a spotless home and safe lights before the festival.', te: 'మీ ఇంటి ప్రతి మూల వెలుగులతో నిండాలి. పండుగకు ముందే ఇల్లు శుభ్రంగా, లైట్లు సురక్షితంగా.' },
  categoryId: 'CLEANING',
  cta: { en: 'Book a festive clean', te: 'పండుగ క్లీనింగ్ బుక్ చేయండి' },
  techBody: { en: 'Festive weeks are the busiest: stay online to get more jobs. Have a bright Diwali!', te: 'పండుగ రోజుల్లో పని ఎక్కువ: ఎక్కువ పనుల కోసం ఆన్‌లైన్‌లో ఉండండి. దీపావళి శుభాకాంక్షలు!' },
};

export const FESTIVALS: readonly Festival[] = [
  { id: 'diwali-2026', from: '2026-10-23', to: '2026-11-10', coupon: 'DIWALI26', ...DIWALI },
  {
    id: 'christmas-2026', from: '2026-12-20', to: '2026-12-26', theme: 'lights',
    title: { en: 'Merry Christmas', te: 'క్రిస్మస్ శుభాకాంక్షలు' },
    body: { en: 'Stars, lights and family at home. Get your lights and sockets checked before the party.', te: 'నక్షత్రాలు, లైట్లు, కుటుంబంతో పండుగ. పార్టీకి ముందే లైట్లు, సాకెట్లు చెక్ చేయించుకోండి.' },
    categoryId: 'ELECTRICAL', cta: { en: 'Book an electrician', te: 'ఎలక్ట్రీషియన్‌ను బుక్ చేయండి' },
    coupon: 'XMAS26',
    techBody: { en: 'Merry Christmas! Thank you for keeping homes running across India.', te: 'క్రిస్మస్ శుభాకాంక్షలు! దేశమంతటా ఇళ్లను నడిపిస్తున్నందుకు ధన్యవాదాలు.' },
  },
  {
    id: 'new-year-2027', from: '2026-12-30', to: '2027-01-02', theme: 'lights',
    title: { en: 'Happy New Year', te: 'నూతన సంవత్సర శుభాకాంక్షలు' },
    body: { en: 'A fresh year for your home: fix the little things you have been putting off.', te: 'మీ ఇంటికి కొత్త సంవత్సరం: వాయిదా వేసిన చిన్న పనులు ఇప్పుడే పూర్తి చేయండి.' },
    categoryId: null, cta: null,
    coupon: 'NEWYEAR27',
    techBody: { en: 'Happy New Year! Here’s to more jobs, good ratings and steady earnings.', te: 'నూతన సంవత్సర శుభాకాంక్షలు! మరిన్ని పనులు, మంచి రేటింగ్‌లు, స్థిరమైన ఆదాయం కలగాలి.' },
  },
  {
    id: 'sankranti-2027', from: '2027-01-10', to: '2027-01-16', theme: 'kites',
    title: { en: 'Happy Sankranti', te: 'సంక్రాంతి శుభాకాంక్షలు' },
    body: { en: 'Kites up, rangoli out, family home. Get the house ready for the festival.', te: 'గాలిపటాలు, ముగ్గులు, ఇంటికి వచ్చే బంధువులు. పండుగకు ఇల్లు సిద్ధం చేయండి.' },
    categoryId: 'CLEANING', cta: { en: 'Book a festive clean', te: 'పండుగ క్లీనింగ్ బుక్ చేయండి' },
    coupon: 'SANKRANTI27',
    techBody: { en: 'Happy Sankranti! Enjoy the festival with your family.', te: 'సంక్రాంతి శుభాకాంక్షలు! కుటుంబంతో పండుగ ఆనందంగా జరుపుకోండి.' },
  },
  {
    id: 'ramzan-2027', from: '2027-03-07', to: '2027-03-12', theme: 'moon',
    title: { en: 'Eid Mubarak', te: 'ఈద్ ముబారక్' },
    body: { en: 'Wishing your home joy, guests and good food. Cool rooms for the gathering?', te: 'మీ ఇంట్లో ఆనందం, అతిథులు, మంచి విందు. విందుకు గదులు చల్లగా ఉండాలా?' },
    categoryId: 'AC', cta: { en: 'Book an AC service', te: 'AC సర్వీస్ బుక్ చేయండి' },
    coupon: 'EID27',
    techBody: { en: 'Eid Mubarak! Thank you for your hard work all month.', te: 'ఈద్ ముబారక్! నెలంతా మీ కష్టానికి ధన్యవాదాలు.' },
  },
  {
    id: 'holi-2027', from: '2027-03-19', to: '2027-03-23', theme: 'colours',
    title: { en: 'Happy Holi', te: 'హోలీ శుభాకాంక్షలు' },
    body: { en: 'Play with colours, we’ll handle the cleaning after.', te: 'రంగులతో ఆడుకోండి, తర్వాత క్లీనింగ్ మేం చూసుకుంటాం.' },
    categoryId: 'CLEANING', cta: { en: 'Book a clean-up', te: 'క్లీనింగ్ బుక్ చేయండి' },
    coupon: 'HOLI27',
    techBody: { en: 'Happy Holi! Many homes need a clean-up after the colours: stay online.', te: 'హోలీ శుభాకాంక్షలు! రంగుల తర్వాత చాలా ఇళ్లకు క్లీనింగ్ కావాలి: ఆన్‌లైన్‌లో ఉండండి.' },
  },
  {
    id: 'ugadi-2027', from: '2027-04-04', to: '2027-04-08', theme: 'leaves',
    title: { en: 'Happy Ugadi', te: 'ఉగాది శుభాకాంక్షలు' },
    body: { en: 'A new year, mango leaves at the door, and a cool home for the summer ahead.', te: 'కొత్త సంవత్సరం, గుమ్మానికి మామిడి తోరణాలు, రాబోయే వేసవికి చల్లని ఇల్లు.' },
    categoryId: 'AC', cta: { en: 'Get your AC summer-ready', te: 'AC ని వేసవికి సిద్ధం చేయండి' },
    coupon: 'UGADI27',
    techBody: { en: 'Happy Ugadi! Summer is coming: AC jobs pick up soon.', te: 'ఉగాది శుభాకాంక్షలు! వేసవి వస్తోంది: త్వరలో AC పనులు పెరుగుతాయి.' },
  },
  {
    id: 'bakrid-2027', from: '2027-05-15', to: '2027-05-18', theme: 'moon',
    title: { en: 'Eid al-Adha Mubarak', te: 'బక్రీద్ ముబారక్' },
    body: { en: 'Wishing your family peace and plenty. Your home, ready for guests.', te: 'మీ కుటుంబానికి శాంతి, సమృద్ధి. అతిథుల కోసం మీ ఇల్లు సిద్ధం.' },
    categoryId: 'CLEANING', cta: { en: 'Book a clean', te: 'క్లీనింగ్ బుక్ చేయండి' },
    coupon: 'BAKRID27',
    techBody: { en: 'Eid Mubarak! Enjoy the festival with your family.', te: 'ఈద్ ముబారక్! కుటుంబంతో పండుగ ఆనందంగా జరుపుకోండి.' },
  },
  {
    id: 'independence-2027', from: '2027-08-13', to: '2027-08-15', theme: 'flag',
    title: { en: 'Happy Independence Day', te: 'స్వాతంత్ర్య దినోత్సవ శుభాకాంక్షలు' },
    body: { en: 'Proud of every hand that keeps India’s homes running.', te: 'భారతదేశ ఇళ్లను నడిపించే ప్రతి చేతికి గర్వంగా.' },
    categoryId: null, cta: null,
    coupon: 'FREEDOM27',
    techBody: { en: 'Happy Independence Day! Proud to work with you.', te: 'స్వాతంత్ర్య దినోత్సవ శుభాకాంక్షలు! మీతో పని చేయడం గర్వంగా ఉంది.' },
  },
  {
    id: 'bathukamma-dussehra-2027', from: '2027-09-30', to: '2027-10-10', theme: 'flowers',
    title: { en: 'Happy Bathukamma & Dussehra', te: 'బతుకమ్మ, దసరా శుభాకాంక్షలు' },
    body: { en: 'Flowers, songs and family at home. Get the house festival-ready.', te: 'పూలు, పాటలు, ఇంట్లో కుటుంబం. ఇంటిని పండుగకు సిద్ధం చేయండి.' },
    categoryId: 'CLEANING', cta: { en: 'Book a festive clean', te: 'పండుగ క్లీనింగ్ బుక్ చేయండి' },
    coupon: 'DUSSEHRA27',
    techBody: { en: 'Happy Bathukamma and Dussehra! Festive weeks are busy: stay online.', te: 'బతుకమ్మ, దసరా శుభాకాంక్షలు! పండుగ రోజుల్లో పని ఎక్కువ: ఆన్‌లైన్‌లో ఉండండి.' },
  },
  { id: 'diwali-2027', from: '2027-10-20', to: '2027-10-31', coupon: 'DIWALI27', ...DIWALI },
];

/** The festival whose days include `now` (India time), or null. */
export function festivalAt(now: number, list: readonly Festival[] = FESTIVALS): Festival | null {
  const day = new Date(now + 5.5 * 3_600_000).toISOString().slice(0, 10);
  return list.find((f) => f.from <= day && day <= f.to) ?? null;
}
