import catalog from '../catalog/catalog.data.json';
import { type ChatBooking, chatReply } from './chat-rules';
import { FALLBACK_PROBLEMS } from './top-problems';

const FACTS = { visitFee: 49, quoteMin: 100 };
const booking = (over: Partial<ChatBooking> = {}): ChatBooking => ({
  id: 'b-1',
  visitFeePaid: 49,
  code: 'HF-48291',
  status: 'MATCHING',
  technicianName: null,
  etaMin: null,
  quoteTotal: null,
  extraTotal: null,
  billAmount: null,
  ...over,
});
const en = (message: string, active: ChatBooking | null = null) => chatReply(message, 'en', active, FACTS);

describe('support chat rules', () => {
  it('hands anything dangerous to a person straight away', () => {
    for (const m of ['The switch is sparking!', 'I smell gas', 'got a shock from the fan']) {
      expect(en(m, booking())).toMatchObject({ offerHuman: true, suggestions: [] });
      expect(en(m).text).toContain('112');
    }
    expect(chatReply('స్విచ్ నుండి నిప్పు వస్తోంది', 'te', null, FACTS)).toMatchObject({ offerHuman: true });
  });

  it('offers a person when asked, and when it does not understand', () => {
    expect(en('can I talk to a human?')).toMatchObject({ offerHuman: true });
    expect(en('asdf qwerty')).toMatchObject({ offerHuman: true, suggestions: ['Where is my technician?', 'How much will it cost?', 'Cancel my booking', 'Talk to a person'] });
    expect(en('recall the order').offerHuman).toBe(true); // "recall" is not "call": not understood, so a person is offered
    expect(en('recall the order').text).toMatch(/^Sorry/);
  });

  it("answers where the technician is from the caller's booking", () => {
    expect(en('where is my technician?').text).toBe("You don't have an active booking right now.");
    expect(en('where is my technician?', booking()).text).toBe("We're finding a technician for booking HF-48291.");
    expect(en('where is my technician?', booking({ status: 'EN_ROUTE', technicianName: 'Swathi', etaMin: 7 }))).toEqual({
      text: 'Swathi is on the way and should reach you in about 7 min.',
      suggestions: ['Talk to a person'], // on the way: no cancelling from the chat
      offerHuman: false,
      links: [],
      action: null,
    });
    expect(en('when will he come', booking({ status: 'EN_ROUTE' })).text).toBe('Your technician is on the way to you.');
    expect(en('what is my quote', booking({ status: 'QUOTE_SHARED', technicianName: 'Swathi', quoteTotal: 320 })).text).toContain('₹320');
    expect(en('bill?', booking({ status: 'PAYMENT_DUE', billAmount: 660 })).text).toContain('₹660');
    expect(chatReply('నా టెక్నీషియన్ ఎక్కడ?', 'te', booking({ status: 'EN_ROUTE', technicianName: 'Swathi', etaMin: 7 }), FACTS).text).toBe('Swathi దారిలో ఉన్నారు, సుమారు 7 నిమిషాల్లో వస్తారు.');
  });

  it('names the founders with their links, always the same fixed answer', () => {
    for (const q of ['Who are the founders?', 'who made housefi', 'Who is the CEO', 'co-founder details please']) {
      const a = en(q, booking());
      expect(a.text).toContain('Sujal Negi and Navya, students at IIITDM Kurnool');
      expect(a.links).toEqual([
        { label: 'Sujal Negi', url: 'https://sujalnegi.tech' },
        { label: 'Navya', url: 'https://www.linkedin.com/in/navya-made-7236b633a/' },
      ]);
      expect(a.action).toBeNull();
    }
    expect(chatReply('Housefi వ్యవస్థాపకులు ఎవరు?', 'te', null, FACTS).text).toContain('సుజల్ నేగి');
    // A house owner is not a founder: a cancel request stays a cancel request.
    expect(en('cancel, the owner of the house is not home', booking()).action).toMatchObject({ reason: 'PLANS_CHANGED' });
  });

  it('cancels only with a checked reason, before the trip, and only after the customer confirms', () => {
    // A bare "cancel" asks why, with reasons to tap (each carries the request).
    const ask = en('cancel my booking', booking({ status: 'ASSIGNED' }));
    expect(ask.action).toBeNull();
    expect(ask.text).toContain('Why do you want to cancel HF-48291');
    expect(ask.suggestions).toContain('Cancel: plans changed');
    // Too vague: asked again.
    expect(en('cancel because no', booking()).action).toBeNull();
    // A real reason: a confirm card with the refund, never a cancellation by itself.
    expect(en('Cancel: plans changed', booking({ status: 'ASSIGNED' })).action).toEqual({ kind: 'CANCEL_BOOKING', bookingId: 'b-1', code: 'HF-48291', reason: 'PLANS_CHANGED', refund: 49 });
    expect(en('please cancel, the tap is working now', booking()).action).toMatchObject({ reason: 'FIXED', refund: 49 });
    expect(en('cancel it, I booked by mistake', booking()).action).toMatchObject({ reason: 'MISTAKE' });
    expect(en('cancel because my landlord will fix it himself', booking()).action).toMatchObject({ reason: 'OTHER' });
    // Not paid yet: nothing to refund.
    const unpaid = en('Cancel: booked by mistake', booking({ status: 'AWAITING_PAYMENT', visitFeePaid: 0 }));
    expect(unpaid).toMatchObject({ action: { refund: 0 } });
    expect(unpaid.text).toContain('Nothing has been charged');
    // The technician has started the trip, or is there: no cancelling from the chat.
    expect(en('Cancel: plans changed', booking({ status: 'EN_ROUTE' }))).toMatchObject({ action: null, offerHuman: true });
    expect(en('Cancel: plans changed', booking({ status: 'INSPECTING' }))).toMatchObject({ action: null, offerHuman: true });
    expect(en('cancel').text).toBe("You don't have an active booking to cancel.");
  });

  it('reschedules only where the app allows it', () => {
    expect(en('can I reschedule?', booking({ status: 'ASSIGNED' })).text).toContain('"Reschedule"');
    expect(en('can I reschedule?', booking({ status: 'IN_PROGRESS' })).text).toContain("can't be moved");
  });

  it('answers prices and refunds from the configured amounts, and greets', () => {
    expect(en('how much does it cost?').text).toContain('₹49');
    expect(en('how much does it cost?').text).toContain('₹100');
    expect(chatReply('price', 'en', null, { visitFee: 59, quoteMin: 150 }).text).toContain('₹59');
    expect(en('when do I get my refund').text).toContain('5–7 working days');
    expect(en('Hello!')).toMatchObject({ offerHuman: false, text: "Hi! I'm the Housefi assistant. How can I help?" });
    expect(chatReply('నమస్తే', 'te', null, FACTS).suggestions).toContain('మనిషితో మాట్లాడాలి');
  });
});

describe('top problems fallback list', () => {
  it('only names services and issues that are in the catalog', () => {
    const issues = new Set(catalog.services.flatMap((s) => s.issues.map((i: { id: string }) => `${s.id}/${i.id}`)));
    for (const p of FALLBACK_PROBLEMS) expect(issues).toContain(`${p.serviceId}/${p.issueId}`);
  });
});
