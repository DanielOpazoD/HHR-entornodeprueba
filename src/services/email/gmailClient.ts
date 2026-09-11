import { google } from 'googleapis';
import { buildCensusEmailBody, buildCensusEmailSubject } from '@/constants/email';

interface SendCensusEmailParams {
  date: string;
  recipients: string[];
  attachmentBuffer?: ArrayBuffer | Buffer;
  attachmentName?: string;
  nursesSignature?: string;
  /** Optional explicit subject override for operational flows such as fuga notifications. */
  subject?: string;
  /** Optional plain-text body override. Defaults to the standard census email body when omitted. */
  body?: string;

  encryptionPin?: string;
  /**
   * Optional sender identity. Gmail only honours a From that belongs to the authorized mailbox
   * (or one of its verified aliases), so a different sender needs its own refresh token.
   */
  sender?: { name: string; email: string };
  /** Refresh token of the mailbox that owns `sender`; defaults to the institutional mailbox. */
  refreshToken?: string;
  /** Operational delivery uses bounded requests and a stable diagnostic Message-ID. */
  deliveryOptions?: { timeoutMs: number; messageId: string };
}

export const DEFAULT_GMAIL_SENDER = Object.freeze({
  name: 'Hospital Hanga Roa',
  email: 'hospitalizados@hospitalhangaroa.cl',
});

const getOAuth2Client = (refreshTokenOverride?: string) => {
  const clientId = process.env.GMAIL_CLIENT_ID;
  const clientSecret = process.env.GMAIL_CLIENT_SECRET;
  const refreshToken = refreshTokenOverride || process.env.GMAIL_REFRESH_TOKEN;

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error(
      'Faltan credenciales de Gmail. Configura GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET y GMAIL_REFRESH_TOKEN.'
    );
  }

  const oauth2Client = new google.auth.OAuth2(clientId, clientSecret);
  oauth2Client.setCredentials({ refresh_token: refreshToken });
  return oauth2Client;
};

const base64UrlEncode = (value: Buffer) =>
  value.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const encodeHeaderUtf8 = (value: string) =>
  `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`;

const buildMimeMessage = (params: SendCensusEmailParams) => {
  const {
    date,
    recipients,
    attachmentBuffer,
    attachmentName,
    nursesSignature,
    subject,
    body,
    encryptionPin,
    sender = DEFAULT_GMAIL_SENDER,
  } = params;

  if (
    /[\r\n]/.test(sender.name) ||
    !/^[^\s<>@,;\r\n]+@[^\s<>@,;\r\n]+\.[^\s<>@,;\r\n]+$/.test(sender.email)
  ) {
    throw new Error('Remitente de correo inválido.');
  }
  if (
    params.deliveryOptions &&
    !/^<hhr-alert-[a-zA-Z0-9-]+@hospitalhangaroa\.cl>$/.test(params.deliveryOptions.messageId)
  ) {
    throw new Error('Referencia de correo inválida.');
  }
  const boundary = '----=_Part_0_123456789.123456789';
  const mailSubject = subject || buildCensusEmailSubject(date);
  const baseBody = body || buildCensusEmailBody(date, nursesSignature, encryptionPin);
  // Audit line removed per user request
  const mailBodyBase64 = Buffer.from(baseBody).toString('base64');
  const parts = [
    'Content-Type: multipart/mixed; boundary="' + boundary + '"',
    'MIME-Version: 1.0',
    'Content-Language: es-CL',
    `From: ${encodeHeaderUtf8(sender.name)} <${sender.email}>`,
    'To: ' + recipients.join(', '),
    'Subject: ' + encodeHeaderUtf8(mailSubject),
    ...(params.deliveryOptions ? ['Message-ID: ' + params.deliveryOptions.messageId] : []),
    '',
    '--' + boundary,
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Language: es-CL',
    'Content-Transfer-Encoding: base64',
    'Content-Disposition: inline',
    '',
    mailBodyBase64,
    '',
  ];

  if (attachmentBuffer && attachmentName) {
    const attachmentBase64 = Buffer.isBuffer(attachmentBuffer)
      ? attachmentBuffer.toString('base64')
      : Buffer.from(attachmentBuffer).toString('base64');

    parts.push(
      '--' + boundary,
      'Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet; name="' +
        attachmentName +
        '"',
      'MIME-Version: 1.0',
      'Content-Transfer-Encoding: base64',
      'Content-Disposition: attachment; filename="' + attachmentName + '"',
      '',
      attachmentBase64
    );
  }

  parts.push('--' + boundary + '--');

  return parts.join('\r\n');
};

export const sendCensusEmail = async (params: SendCensusEmailParams) => {
  const oauth2Client = getOAuth2Client(params.refreshToken);
  const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

  const mimeMessage = buildMimeMessage(params);
  const raw = base64UrlEncode(Buffer.from(mimeMessage));

  const response = await gmail.users.messages.send(
    {
      userId: 'me',
      requestBody: { raw },
    },
    params.deliveryOptions ? { timeout: params.deliveryOptions.timeoutMs, retry: false } : undefined
  );

  return response.data;
};
