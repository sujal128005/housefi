// Session tokens live only in the secret store; older plaintext tokens in the preferences are moved once.
import { memoryStore } from '../services/mock/MockBackend';
import { readTokens, TOKEN_KEYS, withoutTokens, writeToken } from '../state/sessionTokens';

describe('session tokens', () => {
  it('reads tokens from the secret store only', async () => {
    const secrets = memoryStore();
    await secrets.set(TOKEN_KEYS.token, 'tok_customer');
    const r = await readTokens({ locale: 'en' }, secrets);
    expect(r).toEqual({ token: 'tok_customer', techToken: null, migrated: false });
  });

  it('moves a token an older version left in the plain preferences', async () => {
    const secrets = memoryStore();
    const r = await readTokens({ locale: 'te', token: 'old_plain', techToken: null }, secrets);
    expect(r.token).toBe('old_plain');
    expect(r.migrated).toBe(true);
    expect(await secrets.get(TOKEN_KEYS.token)).toBe('old_plain');
  });

  it('prefers the secret store over a stale plaintext copy', async () => {
    const secrets = memoryStore();
    await secrets.set(TOKEN_KEYS.techToken, 'current');
    const r = await readTokens({ techToken: 'stale' }, secrets);
    expect(r.techToken).toBe('current');
    expect(r.migrated).toBe(true);
  });

  it('never writes tokens into the preferences', () => {
    const prefs = { locale: 'en', role: 'CUSTOMER', token: 'secret', techToken: 'secret2', feedback: true };
    const out = JSON.stringify(withoutTokens(prefs));
    expect(out).not.toContain('secret');
    expect(out).toContain('CUSTOMER');
  });

  it('removes a token on sign-out', async () => {
    const secrets = memoryStore();
    await writeToken(secrets, 'token', 'tok');
    await writeToken(secrets, 'token', null);
    expect(await secrets.get(TOKEN_KEYS.token)).toBeNull();
  });
});
