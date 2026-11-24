const crypto = require('crypto');
const { promisify } = require('util');
const { HttpsError } = require('firebase-functions/v2/https');
const { getAccessConfigRef } = require('./prescriptionUploadReadSupport');

const MIN_PIN_LENGTH = 4;
const MAX_PIN_LENGTH = 12;

// Brute-force protection. Tracked in the same `prescriptionsAccess` doc.
const MAX_PIN_FAILED_ATTEMPTS = 5;
const PIN_LOCKOUT_MINUTES = 15;
const PIN_LOCKOUT_MS = PIN_LOCKOUT_MINUTES * 60 * 1000;
const PIN_HASH_ALGORITHM = 'scrypt';
const PIN_SCRYPT_PARAMS = Object.freeze({
  N: 16_384,
  r: 8,
  p: 1,
  keyLength: 32,
});
/** @type {(password: string, salt: string, keylen: number, options: crypto.ScryptOptions) => Promise<Buffer>} */
const scryptAsync = /** @type {any} */ (promisify(crypto.scrypt));

const ADMIN_ALLOWED_ROLES = new Set(['admin']);
const AUTHENTICATED_UPLOAD_ALLOWED_ROLES = new Set([
  'admin',
  'nurse_hospital',
  'doctor_urgency',
  'doctor_specialist',
]);

const normalizeScryptParams = params => ({
  N: Number(params?.N || PIN_SCRYPT_PARAMS.N),
  r: Number(params?.r || PIN_SCRYPT_PARAMS.r),
  p: Number(params?.p || PIN_SCRYPT_PARAMS.p),
  keyLength: Number(params?.keyLength || PIN_SCRYPT_PARAMS.keyLength),
});

/**
 * @param {string} pin
 * @param {string} salt
 * @param {{ N?: number; r?: number; p?: number; keyLength?: number }} [params]
 */
const hashPin = async (pin, salt, params = PIN_SCRYPT_PARAMS) => {
  const normalized = normalizeScryptParams(params);
  const derivedKey = await scryptAsync(String(pin), String(salt), normalized.keyLength, {
    N: normalized.N,
    r: normalized.r,
    p: normalized.p,
  });
  return derivedKey.toString('hex');
};

const hashPinLegacySha256 = (pin, salt) =>
  crypto.createHash('sha256').update(`${pin}:${salt}`).digest('hex');

const hashesMatchTimingSafe = (candidateHex, storedHex) => {
  if (typeof candidateHex !== 'string' || typeof storedHex !== 'string') return false;
  const candidateBuffer = Buffer.from(candidateHex, 'utf8');
  const storedBuffer = Buffer.from(storedHex, 'utf8');
  if (candidateBuffer.length !== storedBuffer.length) return false;
  return crypto.timingSafeEqual(candidateBuffer, storedBuffer);
};

const generatePinSalt = () => crypto.randomBytes(16).toString('hex');

const requireAuthentication = context => {
  if (!context?.auth) {
    throw new HttpsError('unauthenticated', 'User must be authenticated.');
  }
};

const resolveCallerRole = async (context, resolveRoleForEmail) => {
  const email = String(context?.auth?.token?.email || '')
    .toLowerCase()
    .trim();
  if (!email) return 'unauthorized';
  return resolveRoleForEmail(email, context);
};

// A valid PIN authorizes on its own, so a role that could not be read must not stop it.
const resolveCallerRoleBeforePin = async (context, payload, resolveRoleForEmail) => {
  try {
    return await resolveCallerRole(context, resolveRoleForEmail);
  } catch (error) {
    if (!payload.pin) throw error;
    return 'unauthorized';
  }
};

const requirePinString = pin => {
  if (typeof pin !== 'string' || !pin.trim()) {
    throw new HttpsError('invalid-argument', 'PIN ausente o inválido.');
  }
  const trimmed = pin.trim();
  if (trimmed.length < MIN_PIN_LENGTH || trimmed.length > MAX_PIN_LENGTH) {
    throw new HttpsError(
      'invalid-argument',
      `PIN debe tener entre ${MIN_PIN_LENGTH} y ${MAX_PIN_LENGTH} caracteres.`
    );
  }
  return trimmed;
};

const validatePinAgainstConfig = async (firestore, providedPin) => {
  const trimmed = requirePinString(providedPin);
  const ref = getAccessConfigRef(firestore);
  /** @type {Map<string, string>} */
  const scryptCache = new Map();
  // The lock check, the hash comparison and the counter update share one
  // transaction so every failed attempt counts against fresh state.
  // Memoize scrypt per (salt, params) across transaction retries so contention
  // does not recompute the KDF.
  const outcome = await firestore.runTransaction(async tx => {
    const snap = await tx.get(ref);
    if (!snap.exists) {
      throw new HttpsError(
        'failed-precondition',
        'Acceso de recetas no configurado. Pide al administrador que defina un PIN.'
      );
    }
    const data = snap.data() || {};
    if (!data.pinHash || !data.pinSalt) {
      throw new HttpsError('failed-precondition', 'Acceso de recetas no configurado.');
    }

    // Brute-force lockout: if too many recent failures landed us in the
    // cooldown window, refuse the attempt without even checking the hash.
    const now = Date.now();
    if (data.lockedUntil && Date.parse(data.lockedUntil) > now) {
      const minutesLeft = Math.max(1, Math.ceil((Date.parse(data.lockedUntil) - now) / 60_000));
      return { kind: 'locked', minutesLeft };
    }

    let candidate;
    if (data.pinHashAlgorithm === PIN_HASH_ALGORITHM) {
      const params = normalizeScryptParams(data.pinHashParams);
      const cacheKey = `${data.pinSalt}:${params.N}:${params.r}:${params.p}:${params.keyLength}`;
      candidate = scryptCache.get(cacheKey);
      if (!candidate) {
        candidate = await hashPin(trimmed, data.pinSalt, params);
        scryptCache.set(cacheKey, candidate);
      }
    } else {
      candidate = hashPinLegacySha256(trimmed, data.pinSalt);
    }
    // Failed attempts are committed and reported after the transaction;
    // throwing here would roll the counter update back.
    if (!hashesMatchTimingSafe(candidate, data.pinHash)) {
      const failedAttempts = Number(data.failedAttempts || 0) + 1;
      const update = { failedAttempts };
      if (failedAttempts >= MAX_PIN_FAILED_ATTEMPTS) {
        update.lockedUntil = new Date(now + PIN_LOCKOUT_MS).toISOString();
        update.failedAttempts = 0; // Reset counter when entering lockout.
      }
      tx.set(ref, update, { merge: true });
      return { kind: update.lockedUntil ? 'lockedNow' : 'invalid' };
    }

    // Successful PIN: clear any in-flight failure counter / lockout marker.
    if (data.failedAttempts || data.lockedUntil) {
      tx.set(ref, { failedAttempts: 0, lockedUntil: null }, { merge: true });
    }
    return { kind: 'valid' };
  });

  if (outcome.kind === 'locked') {
    throw new HttpsError(
      'permission-denied',
      `Demasiados intentos fallidos. Reintenta en ${outcome.minutesLeft} minuto(s).`
    );
  }
  if (outcome.kind === 'lockedNow') {
    throw new HttpsError(
      'permission-denied',
      `Demasiados intentos fallidos. Acceso bloqueado por ${PIN_LOCKOUT_MINUTES} minutos.`
    );
  }
  if (outcome.kind === 'invalid') {
    throw new HttpsError('permission-denied', 'PIN inválido.');
  }
};

const resolveUploadPickerAccess = async ({ firestore, context, payload, resolveRoleForEmail }) => {
  if (context?.auth) {
    const role = await resolveCallerRoleBeforePin(context, payload, resolveRoleForEmail);
    if (AUTHENTICATED_UPLOAD_ALLOWED_ROLES.has(role)) return;
    if (payload.pin) {
      await validatePinAgainstConfig(firestore, payload.pin);
      return;
    }
    throw new HttpsError(
      'permission-denied',
      'No tienes permiso para ver el selector de pacientes. Usa el QR + PIN.'
    );
  }
  await validatePinAgainstConfig(firestore, payload.pin);
};

/**
 * Resolves the uploader identity for a `submitPrescriptionPhoto` call.
 * Authenticated clinicians with an upload-allowed role take precedence;
 * otherwise the call must include a valid PIN (QR flow). Mixed flows
 * (authenticated user without role + PIN) fall back to the PIN path.
 */
const resolveUploaderIdentity = async ({ firestore, context, payload, resolveRoleForEmail }) => {
  if (context?.auth) {
    const role = await resolveCallerRoleBeforePin(context, payload, resolveRoleForEmail);
    if (AUTHENTICATED_UPLOAD_ALLOWED_ROLES.has(role)) {
      return {
        source: 'authenticated',
        uid: context.auth.uid,
        email: String(context.auth.token?.email || '') || undefined,
      };
    }
    if (payload.pin) {
      await validatePinAgainstConfig(firestore, payload.pin);
      return { source: 'qr_pin' };
    }
    throw new HttpsError(
      'permission-denied',
      'No tienes permiso para subir recetas. Usa el QR + PIN.'
    );
  }

  await validatePinAgainstConfig(firestore, payload.pin);
  return { source: 'qr_pin' };
};

module.exports = {
  ADMIN_ALLOWED_ROLES,
  PIN_HASH_ALGORITHM,
  PIN_SCRYPT_PARAMS,
  hashPin,
  hashPinLegacySha256,
  hashesMatchTimingSafe,
  generatePinSalt,
  requireAuthentication,
  resolveCallerRole,
  requirePinString,
  validatePinAgainstConfig,
  resolveUploadPickerAccess,
  resolveUploaderIdentity,
};
