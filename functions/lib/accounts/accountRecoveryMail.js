const { https } = require('firebase-functions/v1');
const { normalizeRecoveryEmail } = require('./accountPolicy');

const assertRecoveryMailConfigured = () => {
  if (
    !process.env.GMAIL_CLIENT_ID ||
    !process.env.GMAIL_CLIENT_SECRET ||
    !process.env.GMAIL_REFRESH_TOKEN
  ) {
    throw new https.HttpsError(
      'unavailable',
      'La recuperación por correo aún no está disponible. Contacta al administrador.'
    );
  }
};

const sendRecoveryMail = async ({ email, code }) => {
  assertRecoveryMailConfigured();
  const clientId = process.env.GMAIL_CLIENT_ID;
  const clientSecret = process.env.GMAIL_CLIENT_SECRET;
  const refreshToken = process.env.GMAIL_REFRESH_TOKEN;
  const recipient = normalizeRecoveryEmail(email);
  if (!/^\d{8}$/.test(code)) throw new Error('Invalid recovery code');
  const { google } = require('googleapis');
  const oauth = new google.auth.OAuth2(clientId, clientSecret);
  oauth.setCredentials({ refresh_token: refreshToken });
  const body = Buffer.from(
    `Tu código de recuperación HHR es: ${code}\n\nVence 10 minutos después de solicitarlo y se puede usar una sola vez. Si no lo solicitaste, ignora este mensaje.`,
    'utf8'
  ).toString('base64');
  const raw = Buffer.from(
    [
      'From: Hospital Hanga Roa <hospitalizados@hospitalhangaroa.cl>',
      `To: ${recipient}`,
      'Subject: Codigo de recuperacion HHR',
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=UTF-8',
      'Content-Transfer-Encoding: base64',
      '',
      body,
    ].join('\r\n')
  ).toString('base64url');
  await google
    .gmail({ version: 'v1', auth: oauth })
    .users.messages.send({ userId: 'me', requestBody: { raw } }, { timeout: 15000, retry: false });
};
module.exports = { sendRecoveryMail, assertRecoveryMailConfigured };
