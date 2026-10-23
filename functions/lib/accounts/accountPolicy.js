const { createHash, randomBytes, randomUUID } = require('node:crypto');
const { https } = require('firebase-functions/v1');

const ACCESS = 'hhr_account_access';
const PRIVATE = 'hhr_account_private';
const INDEX = 'hhr_account_ruts';
const INVITES = 'hhr_account_invitations';
const POLICY = 'config/individualAccounts';
const PROTECTED = Object.freeze({
  'daniel.opazo@hospitalhangaroa.cl': 'admin',
  'hospitalizados@hospitalhangaroa.cl': 'nurse_hospital',
});
const SESSION_SECONDS = 12 * 60 * 60;
const INVITE_MS = 60 * 60 * 1000;
const genericFailure = () =>
  new https.HttpsError(
    'permission-denied',
    'No se pudo validar el acceso. Revisa tus datos o solicita una nueva activación.'
  );
const digest = value => createHash('sha256').update(value).digest('hex');
const newSecret = () => randomBytes(32).toString('base64url');

const normalizeRut = value => {
  if (typeof value !== 'string' || value.length > 20) throw genericFailure();
  const normalized = value.replace(/[.\s-]/g, '').toUpperCase();
  if (!/^[1-9]\d{6,7}[0-9K]$/.test(normalized)) throw genericFailure();
  const body = normalized.slice(0, -1);
  let sum = 0;
  [...body].reverse().forEach((digit, index) => {
    sum += Number(digit) * (2 + (index % 6));
  });
  const remainder = 11 - (sum % 11);
  const dv = remainder === 11 ? '0' : remainder === 10 ? 'K' : String(remainder);
  if (dv !== normalized.at(-1)) throw genericFailure();
  return `${body}-${dv}`;
};

const assertPassword = password => {
  if (
    typeof password !== 'string' ||
    password.length < 6 ||
    password.length > 128 ||
    !/[A-ZÁÉÍÓÚÜÑ]/.test(password) ||
    !/[0-9]/.test(password)
  ) {
    throw new https.HttpsError(
      'invalid-argument',
      'La clave debe tener de 6 a 128 caracteres, al menos una mayúscula y un número.'
    );
  }
};

const normalizeRecoveryEmail = value => {
  const email = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (
    email.length > 254 ||
    !/^[^\s<>@,;\r\n]+@[^\s<>@,;\r\n]+\.[^\s<>@,;\r\n]+$/.test(email) ||
    email.endsWith('@accounts.hhr.invalid')
  ) {
    throw new https.HttpsError('invalid-argument', 'Ingresa un correo de recuperación válido.');
  }
  return email;
};

const hasCurrentAccountSession = (account, context, now = Date.now()) => {
  const token = context?.auth?.token;
  return Boolean(
    account &&
    token &&
    account.status === 'active' &&
    !account.credentialOperation &&
    token.hhrAccountVersion === account.version &&
    Number.isSafeInteger(token.auth_time) &&
    token.auth_time * 1000 <= now + 60000 &&
    now < (token.auth_time + SESSION_SECONDS) * 1000 &&
    token.firebase?.sign_in_provider === 'password'
  );
};

const protectedRole = (policy, context) => {
  const email = String(context?.auth?.token?.email || '').toLowerCase();
  return policy?.protectedGoogle?.[email] === context?.auth?.uid &&
    context?.auth?.token?.email_verified === true &&
    context?.auth?.token?.firebase?.sign_in_provider === 'google.com'
    ? PROTECTED[email] || null
    : null;
};

const audit = (firestore, transaction, actorUid, targetUid, action, now) => {
  transaction.create(firestore.collection('hhr_account_audit').doc(), {
    actorUid,
    targetUid,
    action,
    at: now,
  });
};

module.exports = {
  ACCESS,
  PRIVATE,
  INDEX,
  INVITES,
  POLICY,
  PROTECTED,
  SESSION_SECONDS,
  INVITE_MS,
  genericFailure,
  digest,
  newSecret,
  normalizeRut,
  assertPassword,
  normalizeRecoveryEmail,
  hasCurrentAccountSession,
  protectedRole,
  audit,
  randomUUID,
};
