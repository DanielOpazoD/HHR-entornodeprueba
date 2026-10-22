// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { auth } from 'googleapis/build/src/apis/gmail';
import { sendCensusEmail } from '@/services/email/gmailClient';

const providerData = { id: 'synthetic-provider-id', threadId: 'synthetic-thread-id' };
const interceptTransport = () =>
  vi
    .spyOn(auth.OAuth2.prototype, 'request')
    .mockImplementation(async () => ({ data: providerData }));

const readMessage = (transport: ReturnType<typeof interceptTransport>) => {
  const options = transport.mock.calls.at(-1)?.[0];
  if (!options) throw new Error('The Gmail SDK did not issue a request.');
  const data: unknown = options.data;
  if (!data || typeof data !== 'object' || !('raw' in data) || typeof data.raw !== 'string') {
    throw new Error('The Gmail SDK request did not contain a raw MIME message.');
  }
  return { options, raw: data.raw, mime: Buffer.from(data.raw, 'base64url').toString('utf8') };
};

const decodeSubject = (mime: string) => {
  const encoded = mime.match(/^Subject: =\?UTF-8\?B\?(.+)\?=\r?$/m)?.[1];
  return Buffer.from(encoded ?? '', 'base64').toString('utf8');
};

const decodeBody = (mime: string) => {
  const encoded = mime.match(/Content-Disposition: inline\r\n\r\n([A-Za-z0-9+/=]+)/)?.[1];
  return Buffer.from(encoded ?? '', 'base64').toString('utf8');
};

describe('Gmail SDK transport compatibility', () => {
  beforeEach(() => {
    vi.stubEnv('GMAIL_CLIENT_ID', 'example');
    vi.stubEnv('GMAIL_CLIENT_SECRET', 'dummy');
    vi.stubEnv('GMAIL_REFRESH_TOKEN', 'test-auth-token');
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new Error('Network is forbidden in this test.')))
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('sends Unicode MIME and attachment bytes with the sender token and bounded delivery options', async () => {
    const transport = interceptTransport();
    const subject = 'Aviso sintético: atención médica 🏥';
    const body = 'Información de prueba\nEnfermería: Ñandú y Rapa Nui.';
    const attachment = Buffer.from([0, 255, 128, 10, 13, 42]);
    const messageId = '<hhr-alert-synthetic-123@hospitalhangaroa.cl>';

    const result = await sendCensusEmail({
      date: '2026-10-21',
      recipients: ['recipient@example.invalid'],
      sender: { name: 'Enfermería sintética', email: 'sender@example.invalid' },
      refreshToken: 'test-token-placeholder',
      subject,
      body,
      attachmentBuffer: attachment,
      attachmentName: 'synthetic.xlsx',
      deliveryOptions: { timeoutMs: 5000, messageId },
    });

    expect(result).toEqual(providerData);
    expect(transport).toHaveBeenCalledTimes(1);
    expect(transport.mock.contexts[0]).toMatchObject({
      credentials: { refresh_token: 'test-token-placeholder' },
    });
    const { options, raw, mime } = readMessage(transport);
    expect(String(options.url)).toBe(
      'https://gmail.googleapis.com/gmail/v1/users/me/messages/send'
    );
    expect(options).toMatchObject({ method: 'POST', timeout: 5000, retry: false });
    expect(raw).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeSubject(mime)).toBe(subject);
    expect(decodeBody(mime)).toBe(body);
    expect(mime).toContain('To: recipient@example.invalid\r\n');
    expect(mime).toContain(' <sender@example.invalid>\r\n');
    expect(mime).toContain(`Message-ID: ${messageId}\r\n`);
    const encodedAttachment = mime.match(
      /Content-Disposition: attachment; filename="synthetic.xlsx"\r\n\r\n([A-Za-z0-9+/=]+)/
    )?.[1];
    expect(Buffer.from(encodedAttachment ?? '', 'base64')).toEqual(attachment);
  });

  it('preserves the default census content and institutional token without adding a timeout', async () => {
    const transport = interceptTransport();

    await expect(
      sendCensusEmail({ date: '2026-10-21', recipients: ['recipient@example.invalid'] })
    ).resolves.toEqual(providerData);

    expect(transport.mock.contexts[0]).toMatchObject({
      credentials: { refresh_token: 'test-auth-token' },
    });
    const { options, mime } = readMessage(transport);
    expect(options.timeout).toBeUndefined();
    expect(options.retry).toBe(true);
    expect(decodeSubject(mime)).toBe('Censo diario pacientes hospitalizados - 21-10-2026');
    expect(decodeBody(mime)).toContain('correspondiente al 21 de octubre de 2026.');
    expect(decodeBody(mime)).toContain('Enfermería - Servicio Hospitalizados');
    expect(mime).toContain(' <hospitalizados@hospitalhangaroa.cl>\r\n');
    expect(mime).not.toContain('Message-ID:');
    expect(mime).not.toContain('Content-Disposition: attachment;');
  });
});
