import catalog from '../catalog/catalog.data.json';
import { type ChatBooking, chatReply } from './chat-rules';
import { FALLBACK_PROBLEMS } from './top-problems';

const FACTS = { visitFee: 49, quoteMin: 100 };
const booking = (over: Partial<ChatBooking> = {}): ChatBooking => ({
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
      suggestions: ['Cancel my booking', 'Talk to a person'],
      offerHuman: false,
    });
    expect(en('when will he come', booking({ status: 'EN_ROUTE' })).text).toBe('Your technician is on the way to you.');
    expect(en('what is my quote', booking({ status: 'QUOTE_SHARED', technicianName: 'Swathi', quoteTotal: 320 })).text).toContain('₹320');
    expect(en('bill?', booking({ status: 'PAYMENT_DUE', billAmount: 660 })).text).toContain('₹660');
    expect(chatReply('నా టెక్నీషియన్ ఎక్కడ?', 'te', booking({ status: 'EN_ROUTE', technicianName: 'Swathi', etaMin: 7 }), FACTS).text).toBe('Swathi దారిలో ఉన్నారు, సుమారు 7 నిమిషాల్లో వస్తారు.');
  });

  it('explains cancelling by where the booking is (README cancellation rules)', () => {
    expect(en('cancel my booking', booking({ status: 'ASSIGNED' })).text).toContain('refunded in full');
    expect(en('cancel', booking({ status: 'EN_ROUTE' })).text).toContain('keeps the ₹49');
    expect(en('cancel', booking({ status: 'AWAITING_PAYMENT' })).text).toContain('nothing is charged');
    expect(en('cancel', booking({ status: 'INSPECTING' }))).toMatchObject({ offerHuman: true });
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
