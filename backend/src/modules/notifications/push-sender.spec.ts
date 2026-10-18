import { EXPO_TOKEN, ExpoPushSender, type PushMessage, PushUnavailable } from './push-sender';

const MSG: PushMessage = { to: 'ExponentPushToken[abc]', title: 'T', body: 'B', data: { kind: 'TECH_ARRIVED' }, priority: 'default', sound: 'default', channelId: 'default' };

function fakeFetch(status: number, body: unknown) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fn = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  }) as unknown as typeof fetch;
  return { fn, calls };
}

describe('Expo push sender', () => {
  it('posts the batch with the access token and maps tickets', async () => {
    const f = fakeFetch(200, { data: [{ status: 'ok', id: 'x' }, { status: 'error', message: 'gone', details: { error: 'DeviceNotRegistered' } }, { status: 'error', details: { error: 'MessageTooBig' } }] });
    const sender = new ExpoPushSender({ accessToken: 'secret', fetch: f.fn });
    const tickets = await sender.send([MSG, MSG, MSG]);
    expect(tickets).toEqual([{ ok: true }, { ok: false, error: 'DeviceNotRegistered', deviceGone: true }, { ok: false, error: 'MessageTooBig', deviceGone: false }]);
    expect(f.calls[0]?.url).toBe('https://exp.host/--/api/v2/push/send');
    expect(f.calls[0]?.init.headers).toMatchObject({ authorization: 'Bearer secret', 'content-type': 'application/json' });
    expect(JSON.parse(f.calls[0]?.init.body as string)).toHaveLength(3);
  });

  it('treats rate limits, server errors and rejected batches as unavailable (retry later)', async () => {
    for (const [status, body] of [[429, {}], [503, {}], [400, { errors: [{ code: 'VALIDATION_ERROR' }] }], [200, { data: [] }]] as const) {
      await expect(new ExpoPushSender({ fetch: fakeFetch(status, body).fn }).send([MSG])).rejects.toBeInstanceOf(PushUnavailable);
    }
  });

  it('sends nothing for an empty batch, and recognises Expo tokens', async () => {
    const f = fakeFetch(200, { data: [] });
    expect(await new ExpoPushSender({ fetch: f.fn }).send([])).toEqual([]);
    expect(f.calls).toHaveLength(0);
    expect(EXPO_TOKEN.test('ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]')).toBe(true);
    expect(EXPO_TOKEN.test('ExpoPushToken[abc]')).toBe(true);
    expect(EXPO_TOKEN.test('fcm-raw-token')).toBe(false);
  });
});
