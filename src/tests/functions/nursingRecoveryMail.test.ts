import { createRequire } from 'node:module';
import { afterEach, describe, expect, it, vi } from 'vitest';
const require = createRequire(import.meta.url);
const { google } = require('googleapis');
const {
  sendRecoveryMail,
  assertRecoveryMailConfigured,
} = require('../../../functions/lib/accounts/accountRecoveryMail.js');

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});
describe('recovery mail transport', () => {
  it('fails closed when the background sender is not configured', async () => {
    vi.stubEnv('GMAIL_CLIENT_ID', '');
    expect(() => assertRecoveryMailConfigured()).toThrow();
    await expect(
      sendRecoveryMail({ email: 'nurse@example.invalid', code: '12345678' })
    ).rejects.toMatchObject({ code: 'unavailable' });
  });
  it('sends only the code to the saved recipient with bounded transport and no retries', async () => {
    for (const key of ['GMAIL_CLIENT_ID', 'GMAIL_CLIENT_SECRET', 'GMAIL_REFRESH_TOKEN'])
      vi.stubEnv(key, 'fake');
    const send = vi.fn(async () => ({}));
    vi.spyOn(google, 'gmail').mockReturnValue({ users: { messages: { send } } });
    await sendRecoveryMail({ email: 'nurse@example.invalid', code: '12345678' });
    const [request, options] = send.mock.calls[0] as unknown as [
      { requestBody: { raw: string } },
      object,
    ];
    const mime = Buffer.from(request.requestBody.raw, 'base64url').toString('utf8');
    expect(mime).toContain('To: nurse@example.invalid\r\n');
    expect(mime).toContain('From: Hospital Hanga Roa <hospitalizados@hospitalhangaroa.cl>');
    expect(Buffer.from(mime.split('\r\n\r\n')[1], 'base64').toString()).toContain('12345678');
    expect(options).toEqual({ timeout: 15000, retry: false });
    await expect(
      sendRecoveryMail({
        email: 'nurse@example.invalid\r\nBcc: other@example.invalid',
        code: '12345678',
      })
    ).rejects.toThrow();
    await expect(
      sendRecoveryMail({ email: 'nurse@example.invalid', code: 'bad-code' })
    ).rejects.toThrow();
    expect(send).toHaveBeenCalledTimes(1);
  });
});
