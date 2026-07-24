/**
 * Prescription Access Cloud Functions
 *
 * Three callable endpoints that mediate the prescription-photo backup
 * module:
 *
 *   - `validatePrescriptionAccessPin({ pin })`
 *       Verifies a candidate PIN against the hashed value stored in
 *       `hospitals/{hospitalId}/config/prescriptionsAccess`. Used by the
 *       QR-flow UI to gate the upload form.
 *
 *   - `submitPrescriptionPhoto({ pin?, ... })`
 *       Single canonical write path. Accepts either an authenticated
 *       caller (admin/nurse_hospital/doctor) or a PIN. Uploads two JPEG
 *       blobs (full + thumbnail) and writes the metadata document. The
 *       legacy `expiresAt` field now marks the suggested monthly backup
 *       review date; records are removed only by manual admin deletion.
 *
 *   - `listPrescriptionUploadPatientOptions({ pin?, date? })`
 *       Returns a minimal census-derived bed picker for the upload form.
 *       Uses the same access rules as upload: authenticated clinicians or
 *       QR + valid PIN. It deliberately returns only bedId, patientName,
 *       and patientRut.
 *
 *   - `listPrescriptionUploadReadonlyRecords({ pin?, date? })`
 *       Returns read-only prescription records for the upload viewer. QR/PIN
 *       access is limited to today/yesterday and receives temporary image URLs
 *       so mobile phones do not need direct Firestore/Storage permissions.
 *
 *   - `setPrescriptionAccessPin({ newPin })`
 *       Admin-only PIN rotation. Hashes with scrypt + per-record salt.
 */

const crypto = require('crypto');
const { promisify } = require('util');
const functions = require('firebase-functions/v1');
const { HOSPITAL_ID } = require('./runtime/runtimeConfig');

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

const getHospitalRef = firestore => firestore.collection('hospitals').doc(HOSPITAL_ID);
const getPrescriptionsRef = firestore => getHospitalRef(firestore).collection('prescriptions');
const getAccessConfigRef = firestore =>
  getHospitalRef(firestore).collection('config').doc('prescriptionsAccess');
const getDailyRecordRef = (firestore, date) =>
  getHospitalRef(firestore).collection('dailyRecords').doc(date);

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
  return resolveRoleForEmail(email);
};

const optionalString = (value, maxLength = 512) =>
  typeof value === 'string' && value.trim() ? value.trim().slice(0, maxLength) : undefined;

const todayIso = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
};

const resolveIsoDate = value => {
  if (value === undefined || value === null || value === '') return todayIso();
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new functions.https.HttpsError('invalid-argument', 'Fecha de censo inválida.');
  }
  return value;
};

const previousIsoDay = isoDate => {
  const [year, month, day] = String(isoDate).split('-').map(Number);
  const date = new Date(year, (month || 1) - 1, day || 1);
  date.setDate(date.getDate() - 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate()
  ).padStart(2, '0')}`;
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
  const snap = await ref.get();
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
    throw new functions.https.HttpsError(
      'permission-denied',
      `Demasiados intentos fallidos. Reintenta en ${minutesLeft} minuto(s).`
    );
  }

  const candidate =
    data.pinHashAlgorithm === PIN_HASH_ALGORITHM
      ? await hashPin(trimmed, data.pinSalt, data.pinHashParams)
      : hashPinLegacySha256(trimmed, data.pinSalt);
  if (candidate !== data.pinHash) {
    const failedAttempts = Number(data.failedAttempts || 0) + 1;
    const update = { failedAttempts };
    if (failedAttempts >= MAX_PIN_FAILED_ATTEMPTS) {
      update.lockedUntil = new Date(now + PIN_LOCKOUT_MS).toISOString();
      update.failedAttempts = 0; // Reset counter when entering lockout.
    }
    await ref.set(update, { merge: true });
    if (update.lockedUntil) {
      throw new functions.https.HttpsError(
        'permission-denied',
        `Demasiados intentos fallidos. Acceso bloqueado por ${PIN_LOCKOUT_MINUTES} minutos.`
      );
    }
    throw new functions.https.HttpsError('permission-denied', 'PIN inválido.');
  }

  // Successful PIN: clear any in-flight failure counter / lockout marker.
  if (data.failedAttempts || data.lockedUntil) {
    await ref.set({ failedAttempts: 0, lockedUntil: null }, { merge: true });
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
    const role = await resolveCallerRole(context, resolveRoleForEmail);
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

const buildPatientOptionsFromDailyRecord = dailyRecord => {
  const beds = dailyRecord?.beds || {};
  const seen = new Set();
  const remember = option => {
    const rutKey = option.patientRut?.replace(/[^0-9kK]/g, '').toLowerCase();
    const identityKey = rutKey || `bed:${option.bedId}`;
    if (seen.has(identityKey)) return false;
    seen.add(identityKey);
    return true;
  };

  const activeBedOptions = Object.entries(beds)
    .filter(
      ([, patient]) =>
        patient && !patient.isBlocked && (patient.patientName?.trim() || patient.rut?.trim())
    )
    .map(([bedId, patient]) => ({
      key: bedId,
      bedId,
      patientName: optionalString(patient.patientName, 256) || '',
      patientRut: optionalString(patient.rut, 32) || '',
      patientStatus: 'active',
    }));

  const movementOptions = [
    ...buildMovementPatientOptions(dailyRecord?.discharges, 'discharge'),
    ...buildMovementPatientOptions(dailyRecord?.transfers, 'transfer'),
  ];

  return [...activeBedOptions, ...movementOptions]
    .filter(remember)
    .sort((a, b) => a.bedId.localeCompare(b.bedId, 'es', { numeric: true }));
};

const buildMovementPatientOptions = (movements, scope) => {
  if (!Array.isArray(movements)) return [];
  return movements
    .map((movement, index) => {
      if (!movement || typeof movement !== 'object') return null;
      const bedId =
        optionalString(movement.bedId, 32) || optionalString(movement.bedName, 32) || '';
      const patientName = optionalString(movement.patientName, 256) || '';
      const patientRut = optionalString(movement.rut, 32) || '';
      if (!bedId || (!patientName && !patientRut)) return null;
      const movementId = optionalString(movement.id, 64) || `${bedId}-${patientRut || index}`;
      return {
        key: `${scope}:${movementId}`,
        bedId,
        patientName,
        patientRut,
        patientStatus: scope,
      };
    })
    .filter(Boolean);
};

const resolveUploadPatientOptionsForDate = async (firestore, date) => {
  const snap = await getDailyRecordRef(firestore, date).get();
  const dailyRecord = snap.exists ? snap.data() || null : null;
  const patientOptions = buildPatientOptionsFromDailyRecord(dailyRecord);
  if (patientOptions.length > 0) {
    return { sourceDate: date, isFallbackFromPreviousDay: false, patientOptions };
  }

  const fallbackDate = previousIsoDay(date);
  const fallbackSnap = await getDailyRecordRef(firestore, fallbackDate).get();
  const fallbackDailyRecord = fallbackSnap.exists ? fallbackSnap.data() || null : null;
  const fallbackPatientOptions = buildPatientOptionsFromDailyRecord(fallbackDailyRecord);
  if (fallbackPatientOptions.length > 0) {
    return {
      sourceDate: fallbackDate,
      isFallbackFromPreviousDay: true,
      patientOptions: fallbackPatientOptions,
    };
  }

  return { sourceDate: date, isFallbackFromPreviousDay: false, patientOptions };
};

const normalizePatientRut = value =>
  String(value || '')
    .toLowerCase()
    .replace(/[^0-9k]/g, '');

const resolveUploadPatientOptionForExactDate = async (
  firestore,
  requestDate,
  sourceDate,
  patientOptionKey,
  expectedPatientRut
) => {
  const resolvedRequestDate = resolveIsoDate(requestDate);
  const resolvedSourceDate = resolveIsoDate(sourceDate);
  assertReadonlyUploadDateAllowed(resolvedRequestDate);
  const canonicalOptions = await resolveUploadPatientOptionsForDate(firestore, resolvedRequestDate);
  if (canonicalOptions.sourceDate !== resolvedSourceDate) {
    throw new functions.https.HttpsError(
      'failed-precondition',
      'El censo disponible cambió. Actualiza el selector antes de subir.'
    );
  }
  const key = optionalString(patientOptionKey, 96);
  if (!key) {
    throw new functions.https.HttpsError(
      'invalid-argument',
      'La selección de cama/paciente es obligatoria.'
    );
  }
  const selected = canonicalOptions.patientOptions.find(option => option.key === key);
  if (!selected) {
    throw new functions.https.HttpsError(
      'failed-precondition',
      'La cama o el paciente ya no están disponibles en el censo seleccionado.'
    );
  }
  const expectedRut = normalizePatientRut(expectedPatientRut);
  const currentRut = normalizePatientRut(selected.patientRut);
  if (!expectedRut || !currentRut || expectedRut !== currentRut) {
    throw new functions.https.HttpsError(
      'failed-precondition',
      'El paciente asociado a la cama cambió. Actualiza el selector antes de subir.'
    );
  }
  return { sourceDate: resolvedSourceDate, patient: selected };
};

const assertReadonlyUploadDateAllowed = date => {
  const today = todayIso();
  const yesterday = previousIsoDay(today);
  if (date !== today && date !== yesterday) {
    throw new functions.https.HttpsError(
      'permission-denied',
      'El visor de carga solo permite revisar recetas de hoy y ayer.'
    );
  }
};

const createdAtMatchesIsoDate = (createdAt, isoDate) => {
  const created = new Date(createdAt);
  if (Number.isNaN(created.getTime())) return false;
  const recordDate = `${created.getFullYear()}-${String(created.getMonth() + 1).padStart(2, '0')}-${String(
    created.getDate()
  ).padStart(2, '0')}`;
  return recordDate === isoDate;
};

const buildFirebaseStorageDownloadUrl = (bucketName, storagePath, token) =>
  `https://firebasestorage.googleapis.com/v0/b/${encodeURIComponent(bucketName)}/o/${encodeURIComponent(
    storagePath
  )}?alt=media&token=${encodeURIComponent(token)}`;

const resolveDownloadUrlForStoragePath = async (storage, storagePath) => {
  if (!storagePath) return null;
  const bucket = storage.bucket();
  const file = bucket.file(storagePath);

  try {
    const [metadata] = await file.getMetadata();
    const tokenValue = metadata?.metadata?.firebaseStorageDownloadTokens;
    const token = String(tokenValue || '')
      .split(',')
      .find(Boolean);
    const bucketName = bucket.name || metadata?.bucket;
    if (token && bucketName) {
      return buildFirebaseStorageDownloadUrl(bucketName, storagePath, token);
    }
  } catch (error) {
    console.error(
      `[prescriptions/readonly] failed to resolve metadata for ${storagePath}:`,
      error.message
    );
  }

  if (typeof file.getSignedUrl === 'function') {
    try {
      const [signedUrl] = await file.getSignedUrl({
        action: 'read',
        expires: Date.now() + 15 * 60 * 1000,
      });
      return signedUrl;
    } catch (error) {
      console.error(
        `[prescriptions/readonly] failed to sign URL for ${storagePath}:`,
        error.message
      );
    }
  }

  return null;
};

const attachReadonlyImageUrls = async (storage, record) => {
  const fullDownloadUrl = await resolveDownloadUrlForStoragePath(
    storage,
    record?.image?.storagePath
  );
  const thumbnailDownloadUrl = await resolveDownloadUrlForStoragePath(
    storage,
    record?.image?.thumbnailStoragePath
  );

  return omitUndefined({
    ...record,
    image: {
      ...(record?.image || {}),
      fullDownloadUrl,
      thumbnailDownloadUrl,
    },
  });
};

const listPrescriptionRecordsForDate = async (firestore, storage, date) => {
  const snapshot = await getPrescriptionsRef(firestore).get();
  const records = [];
  snapshot.forEach(doc => {
    const record = doc.data() || {};
    if (createdAtMatchesIsoDate(record.createdAt, date)) {
      records.push(record);
    }
  });
  records.sort((left, right) =>
    String(right.createdAt || '').localeCompare(String(left.createdAt || ''))
  );
  return Promise.all(records.map(record => attachReadonlyImageUrls(storage, record)));
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
    const role = await resolveCallerRole(context, resolveRoleForEmail);
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

/** Removes keys whose value is `undefined` (Firestore rejects undefined). */
const omitUndefined = value => {
  if (Array.isArray(value)) return value.map(item => omitUndefined(item));
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    const result = {};
    for (const [key, nested] of Object.entries(value)) {
      if (nested === undefined) continue;
      result[key] = omitUndefined(nested);
    }
    return result;
  }
  return value;
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
