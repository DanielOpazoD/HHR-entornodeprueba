/**
 * Prescription Access Cloud Functions
 *
 * Callable endpoints that mediate the prescription-photo backup module:
 *   - `validatePrescriptionAccessPin({ pin })`
 *   - `submitPrescriptionPhoto({ pin?, ... })`
 *   - `listPrescriptionUploadPatientOptions({ pin?, date? })`
 *   - `listPrescriptionUploadReadonlyRecords({ pin?, date? })`
 *   - `setPrescriptionAccessPin({ newPin })`
 */

const crypto = require('crypto');
const { promisify } = require('util');
const functions = require('firebase-functions/v1');
const { HOSPITAL_ID } = require('./runtime/runtimeConfig');
const {
  assertReadonlyUploadDateAllowed,
  getAccessConfigRef,
  getPrescriptionsRef,
  listPrescriptionRecordsForDate,
  omitUndefined,
  optionalString,
  resolveIsoDate,
  resolveUploadPatientOptionForExactDate,
  resolveUploadPatientOptionsForDate,
} = require('./prescriptionUploadReadSupport');

const PRESCRIPTION_TYPES = new Set(['comun', 'psicotropicos', 'benzodiazepinas']);
const PRESCRIPTION_ASSIGNMENT_SCOPES = new Set(['patient', 'unassigned', 'hospitalized_stock']);
const MONTHLY_BACKUP_DAYS_BY_TYPE = {
  comun: 30,
  psicotropicos: 30,
  benzodiazepinas: 30,
};
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_BASE64_BYTES = 4 * 1024 * 1024; // 4 MB per blob (full or thumb)
const MIN_PIN_LENGTH = 4;
const MAX_PIN_LENGTH = 12;
const MIN_DIMENSION = 32;
const MAX_DIMENSION = 4096;

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
const scryptAsync = promisify(crypto.scrypt);

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

const generatePinSalt = () => crypto.randomBytes(16).toString('hex');

const generatePrescriptionId = () => `rx_${Date.now()}_${crypto.randomBytes(6).toString('hex')}`;

const computeExpiresAt = (prescriptionType, createdAtIso) => {
  const days = MONTHLY_BACKUP_DAYS_BY_TYPE[prescriptionType] ?? 30;
  return new Date(new Date(createdAtIso).getTime() + days * DAY_MS).toISOString();
};

const requireAuthentication = context => {
  if (!context?.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated.');
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

const positiveInteger = (value, fieldName) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed <= 0) {
    throw new functions.https.HttpsError(
      'invalid-argument',
      `${fieldName} must be a positive integer.`
    );
  }
  if (parsed < MIN_DIMENSION || parsed > MAX_DIMENSION) {
    throw new functions.https.HttpsError(
      'invalid-argument',
      `${fieldName} must be between ${MIN_DIMENSION} and ${MAX_DIMENSION}.`
    );
  }
  return parsed;
};

const decodeBase64 = (value, fieldName) => {
  if (typeof value !== 'string' || !value.trim()) {
    throw new functions.https.HttpsError(
      'invalid-argument',
      `Missing required field: ${fieldName}`
    );
  }
  const buffer = Buffer.from(value, 'base64');
  if (!buffer.length || buffer.length > MAX_BASE64_BYTES) {
    throw new functions.https.HttpsError(
      'invalid-argument',
      `${fieldName} size is invalid (must be 1–${MAX_BASE64_BYTES} bytes after decoding).`
    );
  }
  return buffer;
};

const requirePinString = pin => {
  if (typeof pin !== 'string' || !pin.trim()) {
    throw new functions.https.HttpsError('invalid-argument', 'PIN ausente o inválido.');
  }
  const trimmed = pin.trim();
  if (trimmed.length < MIN_PIN_LENGTH || trimmed.length > MAX_PIN_LENGTH) {
    throw new functions.https.HttpsError(
      'invalid-argument',
      `PIN debe tener entre ${MIN_PIN_LENGTH} y ${MAX_PIN_LENGTH} caracteres.`
    );
  }
  return trimmed;
};

const validatePinAgainstConfig = async (firestore, providedPin) => {
  const trimmed = requirePinString(providedPin);
  const ref = getAccessConfigRef(firestore);
  // The lock check, the hash comparison and the counter update share one
  // transaction so every failed attempt counts against fresh state.
  const outcome = await firestore.runTransaction(async tx => {
    const snap = await tx.get(ref);
    if (!snap.exists) {
      throw new functions.https.HttpsError(
        'failed-precondition',
        'Acceso de recetas no configurado. Pide al administrador que defina un PIN.'
      );
    }
    const data = snap.data() || {};
    if (!data.pinHash || !data.pinSalt) {
      throw new functions.https.HttpsError(
        'failed-precondition',
        'Acceso de recetas no configurado.'
      );
    }

    // Brute-force lockout: if too many recent failures landed us in the
    // cooldown window, refuse the attempt without even checking the hash.
    const now = Date.now();
    if (data.lockedUntil && Date.parse(data.lockedUntil) > now) {
      const minutesLeft = Math.max(1, Math.ceil((Date.parse(data.lockedUntil) - now) / 60_000));
      return { kind: 'locked', minutesLeft };
    }

    const candidate =
      data.pinHashAlgorithm === PIN_HASH_ALGORITHM
        ? await hashPin(trimmed, data.pinSalt, data.pinHashParams)
        : hashPinLegacySha256(trimmed, data.pinSalt);
    // Failed attempts are committed and reported after the transaction;
    // throwing here would roll the counter update back.
    if (candidate !== data.pinHash) {
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
    throw new functions.https.HttpsError(
      'permission-denied',
      `Demasiados intentos fallidos. Reintenta en ${outcome.minutesLeft} minuto(s).`
    );
  }
  if (outcome.kind === 'lockedNow') {
    throw new functions.https.HttpsError(
      'permission-denied',
      `Demasiados intentos fallidos. Acceso bloqueado por ${PIN_LOCKOUT_MINUTES} minutos.`
    );
  }
  if (outcome.kind === 'invalid') {
    throw new functions.https.HttpsError('permission-denied', 'PIN inválido.');
  }
};

const saveImageBufferToStorage = async ({ storage, path, buffer, contentType }) => {
  const bucket = storage.bucket();
  const token = crypto.randomUUID();
  const file = bucket.file(path);
  await file.save(buffer, {
    resumable: false,
    metadata: {
      contentType,
      metadata: { firebaseStorageDownloadTokens: token },
    },
  });
  return token;
};

const deleteImageBlobIfPresent = async ({ storage, path }) => {
  if (!path) return;
  try {
    await storage.bucket().file(path).delete({ ignoreNotFound: true });
  } catch (error) {
    console.error(`[prescriptions/upload] failed to clean blob ${path}:`, error.message);
  }
};

const cleanupUploadedPrescriptionBlobs = async ({ storage, fullPath, thumbPath }) => {
  await Promise.all([
    deleteImageBlobIfPresent({ storage, path: fullPath }),
    deleteImageBlobIfPresent({ storage, path: thumbPath }),
  ]);
};

const createValidatePinHandler =
  ({ firestore }) =>
  async (data, _context) => {
    await validatePinAgainstConfig(firestore, data?.pin);
    return { valid: true };
  };

const resolveUploadPickerAccess = async ({ firestore, context, payload, resolveRoleForEmail }) => {
  if (context?.auth) {
    const role = await resolveCallerRoleBeforePin(context, payload, resolveRoleForEmail);
    if (AUTHENTICATED_UPLOAD_ALLOWED_ROLES.has(role)) return;
    if (payload.pin) {
      await validatePinAgainstConfig(firestore, payload.pin);
      return;
    }
    throw new functions.https.HttpsError(
      'permission-denied',
      'No tienes permiso para ver el selector de pacientes. Usa el QR + PIN.'
    );
  }
  await validatePinAgainstConfig(firestore, payload.pin);
};

const createListUploadPatientOptionsHandler =
  ({ firestore, resolveRoleForEmail }) =>
  async (data, context) => {
    const payload = data || {};
    await resolveUploadPickerAccess({ firestore, context, payload, resolveRoleForEmail });

    const date = resolveIsoDate(payload.date);
    const optionsResult = await resolveUploadPatientOptionsForDate(firestore, date);
    return {
      date,
      ...optionsResult,
    };
  };

const createListUploadReadonlyRecordsHandler =
  ({ firestore, storage, resolveRoleForEmail }) =>
  async (data, context) => {
    const payload = data || {};
    await resolveUploadPickerAccess({ firestore, context, payload, resolveRoleForEmail });

    const date = resolveIsoDate(payload.date);
    assertReadonlyUploadDateAllowed(date);
    const records = await listPrescriptionRecordsForDate(firestore, storage, date);
    return { date, records };
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
    throw new functions.https.HttpsError(
      'permission-denied',
      'No tienes permiso para subir recetas. Usa el QR + PIN.'
    );
  }

  await validatePinAgainstConfig(firestore, payload.pin);
  return { source: 'qr_pin' };
};

const decodeAndValidateImagePayload = payload => ({
  fullBuffer: decodeBase64(payload.fullImageBase64, 'fullImageBase64'),
  thumbBuffer: decodeBase64(payload.thumbnailBase64, 'thumbnailBase64'),
  width: positiveInteger(payload.fullImageWidth, 'fullImageWidth'),
  height: positiveInteger(payload.fullImageHeight, 'fullImageHeight'),
});

const resolveAssignmentScope = payload => {
  const explicitScope = optionalString(payload.assignmentScope, 64);
  if (explicitScope) {
    if (!PRESCRIPTION_ASSIGNMENT_SCOPES.has(explicitScope)) {
      throw new functions.https.HttpsError('invalid-argument', 'Categoría de receta inválida.');
    }
    return explicitScope;
  }
  return optionalString(payload.bedId, 32) ||
    optionalString(payload.patientName, 256) ||
    optionalString(payload.patientRut, 32)
    ? 'patient'
    : 'unassigned';
};

const buildPrescriptionRecord = ({
  prescriptionId,
  payload,
  uploaderIdentity,
  fullPath,
  thumbPath,
  fullByteSize,
  width,
  height,
  createdAt,
}) => {
  const assignmentScope = resolveAssignmentScope(payload);
  const includePatient = assignmentScope === 'patient';
  return omitUndefined({
    id: prescriptionId,
    hospitalId: HOSPITAL_ID,
    prescriptionType: payload.prescriptionType,
    assignmentScope,
    bedId: includePatient ? optionalString(payload.bedId, 32) : undefined,
    patientName: includePatient ? optionalString(payload.patientName, 256) : undefined,
    patientRut: includePatient ? optionalString(payload.patientRut, 32) : undefined,
    notes: optionalString(payload.notes, 1024),
    image: {
      storagePath: fullPath,
      thumbnailStoragePath: thumbPath,
      byteSize: fullByteSize,
      width,
      height,
      contentType: 'image/jpeg',
    },
    uploader: {
      source: uploaderIdentity.source,
      uid: uploaderIdentity.uid,
      email: uploaderIdentity.email,
      displayName: optionalString(payload.uploaderDisplayName, 128),
    },
    createdAt,
    expiresAt: computeExpiresAt(payload.prescriptionType, createdAt),
  });
};

const createSubmitHandler =
  ({ firestore, storage, resolveRoleForEmail }) =>
  async (data, context) => {
    const payload = data || {};
    if (!PRESCRIPTION_TYPES.has(payload.prescriptionType)) {
      throw new functions.https.HttpsError('invalid-argument', 'Tipo de receta inválido.');
    }
    resolveAssignmentScope(payload);

    const uploaderIdentity = await resolveUploaderIdentity({
      firestore,
      context,
      payload,
      resolveRoleForEmail,
    });
    const { fullBuffer, thumbBuffer, width, height } = decodeAndValidateImagePayload(payload);

    const prescriptionId = generatePrescriptionId();
    const storagePrefix = `prescriptions/${HOSPITAL_ID}/${prescriptionId}`;
    const fullPath = `${storagePrefix}/full.jpg`;
    const thumbPath = `${storagePrefix}/thumb.jpg`;

    try {
      await saveImageBufferToStorage({
        storage,
        path: fullPath,
        buffer: fullBuffer,
        contentType: 'image/jpeg',
      });
      await saveImageBufferToStorage({
        storage,
        path: thumbPath,
        buffer: thumbBuffer,
        contentType: 'image/jpeg',
      });

      const record = buildPrescriptionRecord({
        prescriptionId,
        payload,
        uploaderIdentity,
        fullPath,
        thumbPath,
        fullByteSize: fullBuffer.length,
        width,
        height,
        createdAt: new Date().toISOString(),
      });

      await getPrescriptionsRef(firestore).doc(prescriptionId).set(record);
      return { id: prescriptionId, expiresAt: record.expiresAt };
    } catch (error) {
      await cleanupUploadedPrescriptionBlobs({ storage, fullPath, thumbPath });
      throw error;
    }
  };

const createSetPinHandler =
  ({ firestore, resolveRoleForEmail }) =>
  async (data, context) => {
    requireAuthentication(context);
    const role = await resolveCallerRole(context, resolveRoleForEmail);
    if (!ADMIN_ALLOWED_ROLES.has(role)) {
      throw new functions.https.HttpsError(
        'permission-denied',
        'Solo administradores pueden cambiar el PIN.'
      );
    }
    const newPin = requirePinString(data?.newPin);
    const salt = generatePinSalt();
    const hash = await hashPin(newPin, salt);
    await getAccessConfigRef(firestore).set(
      {
        pinHash: hash,
        pinSalt: salt,
        pinHashAlgorithm: PIN_HASH_ALGORITHM,
        pinHashParams: PIN_SCRYPT_PARAMS,
        failedAttempts: 0,
        lockedUntil: null,
        pinUpdatedAt: new Date().toISOString(),
        pinUpdatedBy: String(context?.auth?.token?.email || '') || null,
      },
      { merge: true }
    );
    return { ok: true };
  };

const createPrescriptionAccessFunctions = ({ firestore, storage, resolveRoleForEmail }) => ({
  validatePrescriptionAccessPin: functions.https.onCall(createValidatePinHandler({ firestore })),
  listPrescriptionUploadPatientOptions: functions.https.onCall(
    createListUploadPatientOptionsHandler({ firestore, resolveRoleForEmail })
  ),
  listPrescriptionUploadReadonlyRecords: functions.https.onCall(
    createListUploadReadonlyRecordsHandler({ firestore, storage, resolveRoleForEmail })
  ),
  submitPrescriptionPhoto: functions.https.onCall(
    createSubmitHandler({ firestore, storage, resolveRoleForEmail })
  ),
  setPrescriptionAccessPin: functions.https.onCall(
    createSetPinHandler({ firestore, resolveRoleForEmail })
  ),
});

module.exports = {
  createPrescriptionAccessFunctions,
  // Direct handler factories for tests (avoid functions.https.onCall wrapping).
  createValidatePinHandler,
  createListUploadPatientOptionsHandler,
  createListUploadReadonlyRecordsHandler,
  createSubmitHandler,
  createSetPinHandler,
  // Pure helpers exposed for unit testing.
  hashPin,
  hashPinLegacySha256,
  generatePinSalt,
  computeExpiresAt,
  // Shared server-side access guard for QR flows that intentionally reuse
  // the prescription PIN. The PIN itself never leaves this module/config.
  validatePinAgainstConfig,
  resolveUploadPatientOptionForExactDate,
};
