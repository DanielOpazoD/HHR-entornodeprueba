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
const {
  ADMIN_ALLOWED_ROLES,
  PIN_HASH_ALGORITHM,
  PIN_SCRYPT_PARAMS,
  generatePinSalt,
  hashPin,
  hashPinLegacySha256,
  requireAuthentication,
  requirePinString,
  resolveCallerRole,
  resolveUploadPickerAccess,
  resolveUploaderIdentity,
  validatePinAgainstConfig,
} = require('./prescriptionPinAuth');

const PRESCRIPTION_TYPES = new Set(['comun', 'psicotropicos', 'benzodiazepinas']);
const PRESCRIPTION_ASSIGNMENT_SCOPES = new Set(['patient', 'unassigned', 'hospitalized_stock']);
const MONTHLY_BACKUP_DAYS_BY_TYPE = {
  comun: 30,
  psicotropicos: 30,
  benzodiazepinas: 30,
};
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_BASE64_BYTES = 4 * 1024 * 1024; // 4 MB per blob (full or thumb)
const MIN_DIMENSION = 32;
const MAX_DIMENSION = 4096;

const generatePrescriptionId = () => `rx_${Date.now()}_${crypto.randomBytes(6).toString('hex')}`;

const computeExpiresAt = (prescriptionType, createdAtIso) => {
  const days = MONTHLY_BACKUP_DAYS_BY_TYPE[prescriptionType] ?? 30;
  return new Date(new Date(createdAtIso).getTime() + days * DAY_MS).toISOString();
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
