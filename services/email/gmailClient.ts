import { google } from 'googleapis';
import { buildCensusEmailBody, buildCensusEmailSubject } from '../../constants/email';

interface SendCensusEmailParams {
    date: string;
    recipients: string[];
    attachmentBuffer?: ArrayBuffer | Buffer;
    attachmentName?: string;
    nursesSignature?: string;
    subject?: string;
    body?: string;

    encryptionPin?: string;
}

const getOAuth2Client = () => {
    const clientId = process.env.GMAIL_CLIENT_ID;
    const clientSecret = process.env.GMAIL_CLIENT_SECRET;
    const refreshToken = process.env.GMAIL_REFRESH_TOKEN;

    if (!clientId || !clientSecret || !refreshToken) {
        throw new Error('Faltan credenciales de Gmail. Configura GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET y GMAIL_REFRESH_TOKEN.');
    }

    const oauth2Client = new google.auth.OAuth2(clientId, clientSecret);
    oauth2Client.setCredentials({ refresh_token: refreshToken });
    return oauth2Client;
};

const base64UrlEncode = (value: Buffer) => value
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

const buildMimeMessage = (params: SendCensusEmailParams) => {
    const { date, recipients, attachmentBuffer, attachmentName, nursesSignature, subject, body, encryptionPin } = params;

    const boundary = '----=_Part_0_123456789.123456789';
    const mailSubject = subject || buildCensusEmailSubject(date);
    const baseBody = body || buildCensusEmailBody(date, nursesSignature, encryptionPin);
    // Audit line removed per user request
    const mailBodyBase64 = Buffer.from(baseBody).toString('base64');
    const parts = [
        'Content-Type: multipart/mixed; boundary="' + boundary + '"',
        'MIME-Version: 1.0',
        'Content-Language: es-CL',
        'From: "Hospital Hanga Roa" <hospitalizados@hospitalhangaroa.cl>',
        'To: ' + recipients.join(', '),
        'Subject: ' + mailSubject,
        '',
        '--' + boundary,
        'Content-Type: text/plain; charset=UTF-8',
        'Content-Language: es-CL',
        'Content-Transfer-Encoding: base64',
        'Content-Disposition: inline',
        '',
        mailBodyBase64,
        ''
    ];

    if (attachmentBuffer && attachmentName) {
        const attachmentBase64 = Buffer.isBuffer(attachmentBuffer)
            ? attachmentBuffer.toString('base64')
            : Buffer.from(attachmentBuffer).toString('base64');

        parts.push(
            '--' + boundary,
            'Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet; name="' + attachmentName + '"',
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
    const oauth2Client = getOAuth2Client();
    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

    const mimeMessage = buildMimeMessage(params);
    const raw = base64UrlEncode(Buffer.from(mimeMessage));

    const response = await gmail.users.messages.send({
        userId: 'me',
        requestBody: { raw }
    });

    return response.data;
};
