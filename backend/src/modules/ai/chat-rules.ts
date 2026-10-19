// The support assistant's v1 brain: keyword rules (like the app's demo, docs/app-contract/MockBackend.ts) over the
// caller's own active booking. Pure, so it is easy to test and to compare with the model that replaces it. When it is
// unsure, or the person asks, or something sounds dangerous, it offers a human (customer care).
import type { BookingStatus, Locale } from '@prisma/client';
import { CANCELLABLE, REFUND_ON_CANCEL, RESCHEDULABLE } from '../bookings/booking-status';

/** What the assistant may know about the caller's current booking (their own data only). */
export interface ChatBooking {
  readonly id: string;
  readonly code: string;
  readonly status: BookingStatus;
  /** First name of the assigned technician. */
  readonly technicianName: string | null;
  readonly etaMin: number | null;
  /** Rupees: the repair quote waiting for an answer, the extra work waiting, the bill due. */
  readonly quoteTotal: number | null;
  readonly extraTotal: number | null;
  readonly billAmount: number | null;
  /** Rupees paid as the visit fee (0 while unpaid): what a cancellation before the trip refunds. */
  readonly visitFeePaid: number;
}

export interface ChatFacts {
  readonly visitFee: number;
  readonly quoteMin: number;
}

/** A link shown under the answer (opens in the browser). */
export interface ChatLink {
  readonly label: string;
  readonly url: string;
}

/**
 * Something the app may do once the customer confirms it. The assistant never acts by itself: it proposes, the app
 * shows a confirm card, and only the customer's tap calls the usual endpoint (which checks everything again).
 */
export interface ChatAction {
  readonly kind: 'CANCEL_BOOKING';
  readonly bookingId: string;
  readonly code: string;
  readonly reason: 'PLANS_CHANGED' | 'FIXED' | 'TOO_LONG' | 'MISTAKE' | 'OTHER';
  /** Rupees refunded (the visit fee once paid; 0 when nothing was paid). */
  readonly refund: number;
}

export interface ChatAnswer {
  readonly text: string;
  readonly suggestions: readonly string[];
  readonly offerHuman: boolean;
  readonly links: readonly ChatLink[];
  readonly action: ChatAction | null;
}

/** Cancelling from the chat: only before the technician has started the trip. */
export const CHAT_CANCELLABLE: readonly BookingStatus[] = CANCELLABLE.filter((s) => s !== 'EN_ROUTE');

/** Reasons the chat accepts for cancelling, each as a quick reply that carries the request with it. */
const REASON_CHIPS: readonly Bi[] = [
  { en: 'Cancel: plans changed', te: 'రద్దు: ప్లాన్ మారింది' },
  { en: 'Cancel: problem fixed itself', te: 'రద్దు: సమస్య సరైపోయింది' },
  { en: 'Cancel: taking too long', te: 'రద్దు: చాలా ఆలస్యం' },
  { en: 'Cancel: booked by mistake', te: 'రద్దు: పొరపాటున బుక్ చేశాను' },
  { en: 'Cancel because ...', te: 'రద్దు ఎందుకంటే ...' },
];

type Bi = { readonly en: string; readonly te: string };

const S = {
  track: { en: 'Where is my technician?', te: 'నా టెక్నీషియన్ ఎక్కడ?' },
  price: { en: 'How much will it cost?', te: 'ధర ఎంత?' },
  cancel: { en: 'Cancel my booking', te: 'బుకింగ్ రద్దు' },
  refund: { en: 'Refund', te: 'రీఫండ్' },
  reschedule: { en: 'Change the time', te: 'సమయం మార్చాలి' },
  human: { en: 'Talk to a person', te: 'మనిషితో మాట్లాడాలి' },
} satisfies Record<string, Bi>;

/** English words match whole words; Telugu has no word boundaries in JS regex, so it matches substrings. */
function matcher(message: string) {
  const m = message.toLowerCase();
  return (en: readonly string[], te: readonly string[] = []) =>
    en.some((w) => new RegExp(`(^|[^a-z])${w.replace(/ /g, '\\s+')}([^a-z]|$)`).test(m)) || te.some((w) => message.includes(w));
}

const fill = (s: string, v: Record<string, string | number>) => s.replace(/\{(\w+)\}/g, (_, k: string) => String(v[k] ?? ''));

function statusLine(b: ChatBooking, f: ChatFacts): Bi {
  const name = { en: b.technicianName || 'Your technician', te: b.technicianName || 'మీ టెక్నీషియన్' };
  const v = { code: b.code, eta: b.etaMin ?? 0, fee: f.visitFee, quote: b.quoteTotal ?? 0, extra: b.extraTotal ?? 0, bill: b.billAmount ?? 0 };
  const t = (en: string, te: string): Bi => ({ en: fill(en.replace('{name}', name.en), v), te: fill(te.replace('{name}', name.te), v) });
  switch (b.status) {
    case 'AWAITING_PAYMENT':
      return t('Booking {code} is waiting for the ₹{fee} visit fee. Pay it to start the search for a technician.', 'బుకింగ్ {code} కోసం ₹{fee} విజిట్ ఫీజు చెల్లించాలి. చెల్లించిన తర్వాత టెక్నీషియన్ కోసం వెతుకుతాం.');
    case 'PAYMENT_PENDING':
      return t("We're confirming your payment for booking {code}. This usually takes a few minutes.", 'బుకింగ్ {code} చెల్లింపును నిర్ధారిస్తున్నాం. సాధారణంగా కొన్ని నిమిషాలు పడుతుంది.');
    case 'MATCHING':
      return t("We're finding a technician for booking {code}.", 'బుకింగ్ {code} కోసం టెక్నీషియన్‌ను వెతుకుతున్నాం.');
    case 'MATCHING_DELAYED':
      return t("It's taking longer than usual to find a technician for {code}, but we're still trying.", '{code} కోసం టెక్నీషియన్ దొరకడానికి సాధారణం కంటే ఎక్కువ సమయం పడుతోంది, ఇంకా ప్రయత్నిస్తున్నాం.');
    case 'UNFULFILLED':
      return t("We couldn't find a technician for {code}. You can choose another time, or cancel for a full refund of the ₹{fee}.", '{code} కోసం టెక్నీషియన్ దొరకలేదు. వేరే సమయం ఎంచుకోవచ్చు, లేదా రద్దు చేస్తే ₹{fee} పూర్తిగా తిరిగి వస్తుంది.');
    case 'ASSIGNED':
      return t('{name} is assigned to booking {code} and will start the trip soon.', '{name} బుకింగ్ {code} కు కేటాయించబడ్డారు, త్వరలో బయలుదేరుతారు.');
    case 'EN_ROUTE':
      return b.etaMin !== null
        ? t('{name} is on the way and should reach you in about {eta} min.', '{name} దారిలో ఉన్నారు, సుమారు {eta} నిమిషాల్లో వస్తారు.')
        : t('{name} is on the way to you.', '{name} మీ దగ్గరికి దారిలో ఉన్నారు.');
    case 'ARRIVED':
      return t('{name} has arrived. Share your start code so they can begin.', '{name} వచ్చారు. పని మొదలుపెట్టడానికి మీ స్టార్ట్ కోడ్ చెప్పండి.');
    case 'INSPECTING':
      return t('{name} is checking the problem. The repair quote comes next.', '{name} సమస్యను పరిశీలిస్తున్నారు. తర్వాత రిపేర్ కొటేషన్ వస్తుంది.');
    case 'QUOTE_SHARED':
      return t('Your repair quote for {code} is ₹{quote}. Approve it, ask for a lower price, or decline it in the booking.', '{code} కోసం మీ రిపేర్ కొటేషన్ ₹{quote}. బుకింగ్‌లో ఆమోదించండి, తక్కువ ధర అడగండి, లేదా తిరస్కరించండి.');
    case 'IN_PROGRESS':
      return t('{name} is working on the repair.', '{name} రిపేర్ చేస్తున్నారు.');
    case 'EXTRA_WORK':
      return t('{name} suggested extra work for ₹{extra}. Approve or decline it in the booking.', '{name} ₹{extra} అదనపు పని సూచించారు. బుకింగ్‌లో ఆమోదించండి లేదా తిరస్కరించండి.');
    case 'PAYMENT_DUE':
      return t('The repair is done. Your bill is ₹{bill}: pay online in the booking, or in cash to the technician.', 'రిపేర్ పూర్తైంది. మీ బిల్లు ₹{bill}: బుకింగ్‌లో ఆన్‌లైన్‌లో లేదా టెక్నీషియన్‌కు నగదుగా చెల్లించండి.');
    default:
      return t('Booking {code} is finished.', 'బుకింగ్ {code} పూర్తైంది.');
  }
}

const DANGER_EN = ['spark', 'sparks', 'sparking', 'fire', 'smoke', 'gas', 'shock', 'electrocuted', 'burning', 'danger', 'dangerous', 'unsafe', 'emergency'];
const DANGER_TE = ['మంట', 'నిప్పు', 'పొగ', 'గ్యాస్', 'షాక్', 'ప్రమాదం'];

/** Sparks, gas, smoke, shocks…: always answered by the fixed safety message and a person, never by a model. */
export function soundsDangerous(message: string): boolean {
  return matcher(message)(DANGER_EN, DANGER_TE);
}

/** The customer asks for a person or complains: customer care is offered whatever else is said. */
export function wantsPerson(message: string): boolean {
  return matcher(message)(['person', 'human', 'agent', 'call', 'customer care', 'support team', 'complaint'], ['మనిషి', 'కాల్', 'ఫిర్యాదు']);
}

/** Who started Housefi: a fixed answer (always the same, never a model's guess), with their links. */
export const FOUNDERS: { readonly text: Bi; readonly links: readonly ChatLink[] } = {
  text: {
    en: 'Housefi was founded by Sujal Negi and Navya, students at IIITDM Kurnool: Sujal is in the 4th year and Navya in the 3rd year. They started it to make home repairs in Hyderabad simple and trustworthy, with verified technicians and fair prices. Tap a name to know more.',
    te: 'Housefi ను IIITDM కర్నూలు విద్యార్థులు సుజల్ నేగి (4వ సంవత్సరం), నవ్య (3వ సంవత్సరం) స్థాపించారు. హైదరాబాద్‌లో ఇంటి రిపేర్లను సులభంగా, నమ్మకంగా చేయడానికి, ధృవీకరించిన టెక్నీషియన్లు, న్యాయమైన ధరలతో దీన్ని ప్రారంభించారు. మరింత తెలుసుకోవడానికి పేరు నొక్కండి.',
  },
  links: [
    { label: 'Sujal Negi', url: 'https://sujalnegi.tech' },
    { label: 'Navya', url: 'https://www.linkedin.com/in/navya-made-7236b633a/' },
  ],
};

/** "Who are the founders?", "who made Housefi?", "who owns this app?". */
export function asksAboutFounders(message: string): boolean {
  return matcher(message)(
    ['founder', 'founders', 'co-founder', 'cofounder', 'co founder', 'who made', 'who built', 'who created', 'who started', 'who owns housefi', 'ceo', 'team behind', 'who is behind'],
    ['వ్యవస్థాప', 'ఫౌండర్', 'ఎవరు తయారు', 'ఎవరు స్థాపించ'],
  );
}

/** "Cancel my booking": answered by the rules (reason, checks, confirm card), never by a model. */
export function wantsCancel(message: string): boolean {
  return matcher(message)(['cancel', 'cancellation'], ['రద్దు']);
}

const REASONS: readonly (readonly [ChatAction['reason'], readonly string[], readonly string[]])[] = [
  ['MISTAKE', ['mistake', 'by mistake', 'wrong address', 'wrong service', 'wrongly', 'accidentally', 'wrong booking'], ['పొరపాటు', 'తప్పుగా']],
  ['FIXED', ['fixed', 'working now', 'works now', 'repaired', 'solved', 'resolved'], ['సరైపోయింది', 'పరిష్కారం', 'బాగైంది']],
  ['TOO_LONG', ['too long', 'taking long', 'late', 'delay', 'delayed', 'waiting', 'slow'], ['ఆలస్యం', 'చాలా సమయం']],
  ['PLANS_CHANGED', ['plans changed', 'plan changed', 'change of plans', 'not needed', "don't need", 'do not need', 'no longer need', 'not home', 'not at home', 'busy', 'going out', 'travelling'], ['ప్లాన్ మారింది', 'అవసరం లేదు', 'ఇంట్లో లేను']],
];

/**
 * The reason in a cancel request, checked: one of the known reasons, or "Cancel because …" with an actual
 * explanation (at least three words). Anything vaguer is null, and the customer is asked again.
 */
export function cancelReasonOf(message: string): ChatAction['reason'] | null {
  const has = matcher(message);
  for (const [reason, en, te] of REASONS) if (has(en, te)) return reason;
  const why = /(?:because|since|ఎందుకంటే)\s+(.+)$/i.exec(message.trim())?.[1] ?? '';
  return why.replace(/[.…]+/g, ' ').trim().split(/\s+/).filter((w) => w.length > 1).length >= 3 ? 'OTHER' : null;
}

/** Answered by the rules even when a model is on: danger, cancelling, the founders. */
export function answeredByRules(message: string): boolean {
  return soundsDangerous(message) || wantsCancel(message) || asksAboutFounders(message);
}

/** The assistant's answer to one message. */
export function chatReply(message: string, locale: Locale, active: ChatBooking | null, facts: ChatFacts): ChatAnswer {
  const has = matcher(message);
  const L = (b: Bi) => b[locale];
  const say = (text: Bi, suggestions: readonly Bi[], offerHuman = false): ChatAnswer => ({ text: L(text), suggestions: suggestions.map(L), offerHuman, links: [], action: null });
  const chips = [S.track, S.price, S.cancel, S.human];
  const v = { fee: facts.visitFee, min: facts.quoteMin };

  // Safety first: a person should take over at once.
  if (soundsDangerous(message)) {
    return say(
      {
        en: 'If anyone is in danger, switch off the main power or gas if it is safe to do so, move away, and call 112. Tap "Call customer care" and we will help right away.',
        te: 'ఎవరికైనా ప్రమాదం ఉంటే, సురక్షితమైతే మెయిన్ పవర్ లేదా గ్యాస్ ఆపేసి, దూరంగా వెళ్లి 112 కు కాల్ చేయండి. "కస్టమర్ కేర్‌కు కాల్" నొక్కండి, వెంటనే సహాయం చేస్తాం.',
      },
      [],
      true,
    );
  }
  if (wantsPerson(message)) {
    return say({ en: 'Sure, I can connect you to our support team. Tap "Call customer care" below.', te: 'సరే, మా సపోర్ట్ టీమ్‌కు కనెక్ట్ చేస్తాను. కింద "కస్టమర్ కేర్‌కు కాల్" నొక్కండి.' }, [], true);
  }
  if (asksAboutFounders(message)) {
    return { text: L(FOUNDERS.text), suggestions: chips.map(L), offerHuman: false, links: FOUNDERS.links, action: null };
  }
  if (wantsCancel(message)) {
    if (!active) return say({ en: "You don't have an active booking to cancel.", te: 'రద్దు చేయడానికి మీకు యాక్టివ్ బుకింగ్ లేదు.' }, chips);
    if (CHAT_CANCELLABLE.includes(active.status)) {
      const reason = cancelReasonOf(message);
      // A real reason first: a bare "cancel" (or something too vague) gets the question again.
      if (!reason) {
        return say(
          {
            en: fill('Sorry to hear that. Why do you want to cancel {code}? Pick a reason, or write "Cancel because" and the reason.', { code: active.code }),
            te: fill('{code} ఎందుకు రద్దు చేయాలనుకుంటున్నారు? ఒక కారణం ఎంచుకోండి, లేదా "రద్దు ఎందుకంటే" అని కారణం రాయండి.', { code: active.code }),
          },
          REASON_CHIPS,
        );
      }
      const refund = REFUND_ON_CANCEL.includes(active.status) ? active.visitFeePaid : 0;
      const money = refund > 0
        ? { en: fill('The ₹{refund} visit fee is refunded to your payment method in 5–7 working days.', { refund }), te: fill('₹{refund} విజిట్ ఫీజు 5–7 పని దినాల్లో మీ చెల్లింపు విధానానికి తిరిగి వస్తుంది.', { refund }) }
        : { en: 'Nothing has been charged, so there is nothing to refund.', te: 'ఏమీ వసూలు చేయలేదు, కాబట్టి రీఫండ్ అవసరం లేదు.' };
      return {
        text: L({ en: fill('Please confirm: cancel {code}? {money}', { code: active.code, money: money.en }), te: fill('నిర్ధారించండి: {code} రద్దు చేయాలా? {money}', { code: active.code, money: money.te }) }),
        suggestions: [],
        offerHuman: false,
        links: [],
        action: { kind: 'CANCEL_BOOKING', bookingId: active.id, code: active.code, reason, refund },
      };
    }
    if (active.status === 'EN_ROUTE') {
      return say(
        {
          en: fill("Your technician has already started the trip for {code}, so I can't cancel it here. Cancelling now in the booking keeps the ₹{fee} visit fee; our team can help.", { ...v, code: active.code }),
          te: fill('{code} కోసం టెక్నీషియన్ ఇప్పటికే బయలుదేరారు, కాబట్టి ఇక్కడ రద్దు చేయలేను. ఇప్పుడు బుకింగ్‌లో రద్దు చేస్తే ₹{fee} విజిట్ ఫీజు తిరిగి రాదు; మా టీమ్ సహాయం చేస్తుంది.', { ...v, code: active.code }),
        },
        [S.human],
        true,
      );
    }
    return say({ en: fill('The technician is already with you for {code}, so it can no longer be cancelled in the app. Our team can help.', { code: active.code }), te: fill('{code} కోసం టెక్నీషియన్ ఇప్పటికే మీ దగ్గర ఉన్నారు, కాబట్టి యాప్‌లో రద్దు చేయలేరు. మా టీమ్ సహాయం చేస్తుంది.', { code: active.code }) }, [S.human], true);
  }
  if (has(['reschedule', 'change the time', 'change time', 'another time', 'postpone'], ['సమయం మార్చ', 'వాయిదా'])) {
    if (active && RESCHEDULABLE.includes(active.status)) {
      return say({ en: fill('Open booking {code} and tap "Reschedule" to pick a new time.', { code: active.code }), te: fill('బుకింగ్ {code} తెరిచి "రీషెడ్యూల్" నొక్కి కొత్త సమయం ఎంచుకోండి.', { code: active.code }) }, [S.track, S.human]);
    }
    return say({ en: "This booking can't be moved to another time right now. You can cancel it and book again, or talk to our team.", te: 'ఈ బుకింగ్ సమయాన్ని ఇప్పుడు మార్చలేం. రద్దు చేసి మళ్లీ బుక్ చేయవచ్చు, లేదా మా టీమ్‌తో మాట్లాడండి.' }, [S.cancel, S.human]);
  }
  if (has(['refund', 'refunded', 'money back'], ['రీఫండ్', 'డబ్బు తిరిగి'])) {
    return say({ en: 'Refunds reach your original payment method within 5–7 working days of the cancellation.', te: 'రద్దు చేసిన 5–7 పని దినాల్లో రీఫండ్ మీ అసలు చెల్లింపు విధానానికి వస్తుంది.' }, [S.human]);
  }
  if (has(['where', 'technician', 'eta', 'late', 'track', 'status', 'quote', 'bill', 'when'], ['ఎక్కడ', 'టెక్నీషియన్', 'ఎప్పుడు', 'కొటేషన్', 'బిల్లు'])) {
    if (!active) return say({ en: "You don't have an active booking right now.", te: 'మీకు ఇప్పుడు యాక్టివ్ బుకింగ్ లేదు.' }, chips);
    const next = CHAT_CANCELLABLE.includes(active.status) ? [S.cancel, S.human] : [S.human];
    return say(statusLine(active, facts), next);
  }
  if (has(['price', 'prices', 'cost', 'fee', 'charge', 'charges', 'how much', 'rate'], ['ధర', 'ఫీజు', 'ఎంత'])) {
    return say(
      {
        en: fill('The visit fee is ₹{fee}, paid when you book. Repair and material charges are quoted after the inspection (from ₹{min}), checked for a fair price, and work starts only after you approve.', v),
        te: fill('విజిట్ ఫీజు ₹{fee}, బుకింగ్ సమయంలో చెల్లిస్తారు. రిపేర్, సామగ్రి ధర తనిఖీ తర్వాత చెబుతారు (₹{min} నుండి), సరైన ధరేనా అని చూస్తాం, మీరు ఒప్పుకున్న తర్వాతే పని మొదలవుతుంది.', v),
      },
      [S.track, S.human],
    );
  }
  if (has(['hi', 'hello', 'hey', 'namaste', 'good morning', 'good evening'], ['నమస్తే', 'హలో', 'నమస్కారం'])) {
    return say({ en: "Hi! I'm the Housefi assistant. How can I help?", te: 'నమస్తే! నేను Housefi అసిస్టెంట్‌ని. మీకు ఎలా సహాయం చేయగలను?' }, chips);
  }
  return say({ en: "Sorry, I didn't get that. Pick one below, or talk to our team.", te: 'క్షమించండి, అది నాకు అర్థం కాలేదు. కింద ఒకటి ఎంచుకోండి, లేదా మా టీమ్‌తో మాట్లాడండి.' }, chips, true);
}
