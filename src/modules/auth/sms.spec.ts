import { Msg91SmsSender } from './sms';

function respond(status: number, body: unknown) {
  return jest.fn(async (_url: string | URL | Request, _init?: RequestInit) => new Response(JSON.stringify(body), { status }));
}

describe('Msg91SmsSender', () => {
  it('sends our code with the DLT template to +91 number', async () => {
    const fetch = respond(200, { type: 'success', request_id: 'r1' });
    await new Msg91SmsSender({ authKey: 'key', templateId: 'tpl', fetch }).sendOtp('9876543210', '123456');
    const [url, init] = fetch.mock.calls[0]!;
    const u = new URL(String(url));
    expect(`${u.origin}${u.pathname}`).toBe('https://control.msg91.com/api/v5/otp');
    expect(Object.fromEntries(u.searchParams)).toEqual({ template_id: 'tpl', mobile: '919876543210', otp: '123456' });
    expect(init?.method).toBe('POST');
    expect((init?.headers as Record<string, string>).authkey).toBe('key');
  });

  it('throws when MSG91 refuses', async () => {
    const sender = (fetch: typeof globalThis.fetch) => new Msg91SmsSender({ authKey: 'k', templateId: 't', fetch });
    await expect(sender(respond(200, { type: 'error', message: 'invalid mobile' })).sendOtp('9876543210', '1')).rejects.toThrow();
    await expect(sender(respond(401, {})).sendOtp('9876543210', '1')).rejects.toThrow();
  });
});
