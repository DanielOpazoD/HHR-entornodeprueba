const { HttpsError } = require('firebase-functions/v2/https');
const { normalizeEmail } = require('./authEmailUtils');

const requireAuthenticatedEmail = context => {
  if (!context.auth) {
    throw new HttpsError('unauthenticated', 'User must be signed in.');
  }

  const email = normalizeEmail(context.auth.token?.email);
  if (!email) {
    throw new HttpsError('invalid-argument', 'User has no email associated.');
  }

  return email;
};

module.exports = {
  normalizeEmail,
  requireAuthenticatedEmail,
};
