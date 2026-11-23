const { HttpsError } = require('firebase-functions/v2/https');
const { HOSPITAL_ID } = require('./runtime/runtimeConfig');
const { hospitalCalendarDay } = require('./hospitalCalendarDay');

const getHospitalRef = firestore => firestore.collection('hospitals').doc(HOSPITAL_ID);
const getPrescriptionsRef = firestore => getHospitalRef(firestore).collection('prescriptions');
const getAccessConfigRef = firestore =>
  getHospitalRef(firestore).collection('config').doc('prescriptionsAccess');
const getDailyRecordRef = (firestore, date) =>
  getHospitalRef(firestore).collection('dailyRecords').doc(date);

const optionalString = (value, maxLength = 512) =>
  typeof value === 'string' && value.trim() ? value.trim().slice(0, maxLength) : undefined;

const resolveIsoDate = value => {
  if (value === undefined || value === null || value === '') return hospitalCalendarDay();
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new HttpsError('invalid-argument', 'Fecha de censo inválida.');
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

// Keep document equivalence aligned with src/utils/rutUtils.ts (separate server runtime).
const patientDocumentIdentityKey = value => {
  const text = String(value || '');
  if (!/\d/.test(text)) return '';
  const hasNonRutLetter = /\p{L}/u.test(text.replace(/[kK](?=[^\p{L}\p{N}]*$)/u, ''));
  return hasNonRutLetter
    ? `passport:${text.toUpperCase().replace(/[\s.-]/g, '')}`
    : (text.match(/[0-9kK]/g) || []).join('').toUpperCase();
};

const buildMovementPatientOptions = (movements, scope) => {
  if (!Array.isArray(movements)) return [];
  return movements
    .map((movement, index) => {
      if (!movement || typeof movement !== 'object') return null;
      // A deleted movement is not a person to choose, as in the app's own selector.
      if (String(movement.deletedAt || '').trim()) return null;
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

const buildPatientOptionsFromDailyRecord = dailyRecord => {
  const beds = dailyRecord?.beds || {};
  const seen = new Set();
  const nameKey = option =>
    option.patientName
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim()
      .replace(/\s+/g, ' ')
      .toLocaleLowerCase('es');
  const remember = option => {
    // Keep the first status (active, discharge, transfer) when the same person reappears.
    const identityKey =
      patientDocumentIdentityKey(option.patientRut) ||
      `bed:${JSON.stringify([option.bedId, nameKey(option)])}`;
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

  const kept = [...activeBedOptions, ...movementOptions].filter(remember);
  // Old movements without an id share one fallback key (R1-RN). When several undocumented people
  // share it, every one of them is keyed by name: a key then names the same person or stops
  // existing when the census changes between listing and uploading, never someone else.
  const undocumentedKeyCount = new Map();
  for (const option of kept) {
    if (patientDocumentIdentityKey(option.patientRut)) continue;
    undocumentedKeyCount.set(option.key, (undocumentedKeyCount.get(option.key) || 0) + 1);
  }
  return kept
    .map(option => {
      const shared =
        !patientDocumentIdentityKey(option.patientRut) && undocumentedKeyCount.get(option.key) > 1;
      return shared ? { ...option, key: `${option.key}:${nameKey(option)}` } : option;
    })
    .sort((a, b) => a.bedId.localeCompare(b.bedId, 'es', { numeric: true }));
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

const assertReadonlyUploadDateAllowed = date => {
  const today = hospitalCalendarDay();
  const yesterday = previousIsoDay(today);
  if (date !== today && date !== yesterday) {
    throw new HttpsError(
      'permission-denied',
      'El visor de carga solo permite revisar recetas de hoy y ayer.'
    );
  }
};

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
    throw new HttpsError(
      'failed-precondition',
      'El censo disponible cambió. Actualiza el selector antes de subir.'
    );
  }
  const key = optionalString(patientOptionKey, 96);
  if (!key) {
    throw new HttpsError('invalid-argument', 'La selección de cama/paciente es obligatoria.');
  }
  const selected = canonicalOptions.patientOptions.find(option => option.key === key);
  if (!selected) {
    throw new HttpsError(
      'failed-precondition',
      'La cama o el paciente ya no están disponibles en el censo seleccionado.'
    );
  }
  const expectedRut = patientDocumentIdentityKey(expectedPatientRut);
  const currentRut = patientDocumentIdentityKey(selected.patientRut);
  if (!expectedRut || !currentRut || expectedRut !== currentRut) {
    throw new HttpsError(
      'failed-precondition',
      'El paciente asociado a la cama cambió. Actualiza el selector antes de subir.'
    );
  }
  return { sourceDate: resolvedSourceDate, patient: selected };
};

const createdAtMatchesIsoDate = (createdAt, isoDate) => {
  const created = new Date(createdAt);
  if (Number.isNaN(created.getTime())) return false;
  return hospitalCalendarDay(created) === isoDate;
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

module.exports = {
  assertReadonlyUploadDateAllowed,
  getAccessConfigRef,
  getPrescriptionsRef,
  listPrescriptionRecordsForDate,
  omitUndefined,
  optionalString,
  resolveIsoDate,
  resolveUploadPatientOptionForExactDate,
  resolveUploadPatientOptionsForDate,
};
