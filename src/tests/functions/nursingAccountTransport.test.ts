import { createRequire } from 'node:module';
import { afterEach, describe, expect, it, vi } from 'vitest';
const require = createRequire(import.meta.url);
const { verifyPassword } = require('../../../functions/lib/accounts/accountTransport.js');
afterEach(() => vi.unstubAllEnvs());
describe('private credential transport', () => {
  const password = 'synthetic-secret-not-to-log';
  const email = 'synthetic@accounts.hhr.invalid';
  it('accepts only a verified token for the requested identity, never a provider UID claim alone', async () => {
    vi.stubEnv('FIREBASE_AUTH_EMULATOR_HOST', '');
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ idToken: 'synthetic-token', localId: 'forged-uid' }),
    });
    const auth = { verifyIdToken: vi.fn().mockResolvedValue({ uid: 'correct', email }) };
    await expect(
      verifyPassword({ auth, email, password, apiKey: 'synthetic-key', fetchImpl })
    ).resolves.toBe('correct');
    expect(auth.verifyIdToken).toHaveBeenCalledWith('synthetic-token', true);
    auth.verifyIdToken.mockResolvedValueOnce({ uid: 'other', email: 'other@accounts.hhr.invalid' });
    await expect(
      verifyPassword({ auth, email, password, apiKey: 'synthetic-key', fetchImpl })
    ).rejects.toMatchObject({ code: 'permission-denied' });
    auth.verifyIdToken.mockRejectedValueOnce(new Error('wrong-project ' + password));
    await expect(
      verifyPassword({ auth, email, password, apiKey: 'synthetic-key', fetchImpl })
    ).rejects.not.toHaveProperty('message', expect.stringContaining(password));
  });
  it('does not expose provider response bodies or send credentials to nonlocal emulator hosts', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error(password));
    vi.stubEnv('FIREBASE_AUTH_EMULATOR_HOST', 'attacker.invalid:9099');
    await expect(
      verifyPassword({ auth: {}, email, password, apiKey: 'synthetic-key', fetchImpl })
    ).rejects.toThrow();
    expect(fetchImpl).not.toHaveBeenCalled();
    vi.stubEnv('FIREBASE_AUTH_EMULATOR_HOST', '');
    await expect(
      verifyPassword({ auth: {}, email, password, apiKey: 'synthetic-key', fetchImpl })
    ).rejects.not.toHaveProperty('message', expect.stringContaining(password));
  });
});
