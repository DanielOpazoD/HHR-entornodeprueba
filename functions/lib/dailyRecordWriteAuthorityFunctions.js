const functions = require('firebase-functions/v1');
const { HOSPITAL_ID } = require('./runtime/runtimeConfig');
const { requireAuthenticatedEmail } = require('./auth/authPolicies');
const { sanitizeLogValue } = require('./logging/redaction');
const {
  collectClinicalEpisodeCoverage,
  evaluateDailyRecordClinicalAuthority,
} = require('./dailyRecordClinicalAuthorityPolicy');
const { findPatientErasures } = require('./dailyRecordErasureGuard');
const {
  RAYEN_CLINICAL_FIELDS,
  RAYEN_BATCH_ONLY_CLINICAL_FIELDS,
  isRayenClinicalWriteFenceActive,
  preserveRayenClinicalFields,
} = require('./dailyRecordClinicalFieldPreservation');
const {
  assertGuardedClinicalPatch,
  assertRayenLegacyClinicalWriteAuthority,
  isGuardedClinicalPatchPath,
  isHistoricalCudyrPatchPath,
  parseRayenClinicalWriteGuard,
} = require('./rayenLegacyClinicalWriteAuthority');

const ALLOWED_DAILY_RECORD_WRITE_ROLES = new Set([
  'admin',
  'nurse_hospital',
  'doctor_urgency',
  'doctor_specialist',
  'editor',
]);

// Fuente de verdad: contrato único de autoridad + campos exclusivos del server.
const {
  CLINICAL_AUTHORITY_BED_FIELDS,
  SERVER_ONLY_CLINICAL_PATCH_FIELDS,
} = require('./dailyRecordAuthorityContract');
const ALLOWED_DAILY_RECORD_PATCH_FIELDS = new Set([
  ...CLINICAL_AUTHORITY_BED_FIELDS,
  ...SERVER_ONLY_CLINICAL_PATCH_FIELDS,
]);

const ALLOWED_DAILY_RECORD_BED_TYPE_OVERRIDE_VALUES = new Set(['UTI', 'UCI', 'MEDIA', null]);
const STRUCTURAL_DAILY_RECORD_PATCH_ROLES = new Set(['admin', 'nurse_hospital']);

const FORBIDDEN_PATCH_PATH_SEGMENTS = new Set(['__proto__', 'prototype', 'constructor']);
const RAYEN_CLINICAL_PATCH_FIELDS = new Set(RAYEN_CLINICAL_FIELDS);

const assertStringField = (value, fieldName) => {
  if (typeof value !== 'string' || !value.trim()) {
    throw new functions.https.HttpsError(
      'invalid-argument',
      `Missing required field: ${fieldName}`
    );
  }

  return value.trim();
};

const isPlainObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);

const normalizeMode = value => (value === 'shadow' ? 'shadow' : 'enforced');

const normalizeOrigin = (value, fallback = 'direct_save') =>
  typeof value === 'string' && value.trim() ? value.trim().slice(0, 80) : fallback;

const normalizeShortString = (value, maxLength = 120) =>
  typeof value === 'string' && value.trim() ? value.trim().slice(0, maxLength) : undefined;

const parseConfirmedBedOccupantIdentity = (
  value,
  fieldName,
  { allowPresenceOnly = false } = {}
) => {
  if (!isPlainObject(value)) {
    throw new functions.https.HttpsError(
      'invalid-argument',
      `Intentional bed clear requires ${fieldName} to be an occupant identity.`
    );
  }
  const presenceOnly = value.presenceOnly === true;
  if (presenceOnly && !allowPresenceOnly) {
    throw new functions.https.HttpsError(
      'invalid-argument',
      `Intentional bed clear does not allow presence-only confirmation for ${fieldName}.`
    );
  }
  const confirmedOccupant = {
    ...(presenceOnly ? { presenceOnly: true } : {}),
    clinicalEpisodeId: normalizeShortString(value.clinicalEpisodeId),
    rut: normalizeShortString(value.rut),
    patientName: normalizeShortString(value.patientName),
    firstSeenDate: normalizeShortString(value.firstSeenDate),
    admissionDate: normalizeShortString(value.admissionDate),
    admissionTime: normalizeShortString(value.admissionTime),
  };
  if (
    !confirmedOccupant.clinicalEpisodeId &&
    !confirmedOccupant.rut &&
    !confirmedOccupant.patientName &&
    !presenceOnly
  ) {
    throw new functions.https.HttpsError(
      'invalid-argument',
      `Intentional bed clear requires ${fieldName} to be non-empty.`
    );
  }
  return confirmedOccupant;
};

const parseIntentionalBedClear = value => {
  if (value === undefined || value === null) return null;
  if (!isPlainObject(value)) {
    throw new functions.https.HttpsError(
      'invalid-argument',
      'Intentional bed clear metadata must be an object.'
    );
  }
  const bedId = assertStringField(value.bedId, 'intentionalBedClear.bedId');
  const target = value.target === 'clinicalCrib' ? 'clinicalCrib' : 'bed';
  if (value.target !== undefined && value.target !== 'bed' && value.target !== 'clinicalCrib') {
    throw new functions.https.HttpsError(
      'invalid-argument',
      'Intentional bed clear contains an invalid target.'
    );
  }
  const confirmedLastUpdated = assertStringField(
    value.confirmedLastUpdated,
    'intentionalBedClear.confirmedLastUpdated'
  );
  const confirmedOccupant =
    value.confirmedOccupant === undefined || value.confirmedOccupant === null
      ? null
      : parseConfirmedBedOccupantIdentity(
          value.confirmedOccupant,
          'intentionalBedClear.confirmedOccupant'
        );
  let confirmedAssociatedCrib;
  if (target === 'bed') {
    confirmedAssociatedCrib =
      value.confirmedAssociatedCrib === undefined || value.confirmedAssociatedCrib === null
        ? value.confirmedAssociatedCrib
        : parseConfirmedBedOccupantIdentity(
            value.confirmedAssociatedCrib,
            'intentionalBedClear.confirmedAssociatedCrib',
            { allowPresenceOnly: true }
          );
  }
  if (bedId.includes('.') || FORBIDDEN_PATCH_PATH_SEGMENTS.has(bedId)) {
    throw new functions.https.HttpsError(
      'invalid-argument',
      'Intentional bed clear contains an invalid bed id.'
    );
  }
  return {
    bedId,
    target,
    confirmedLastUpdated,
    confirmedOccupant,
    ...(target === 'bed' ? { confirmedAssociatedCrib } : {}),
  };
};

const normalizeEpisodeIdentityScalar = value =>
  String(value || '')
    .trim()
    .toLowerCase();

const sameConfirmedBedEpisode = (confirmed, remote) => {
  if (!isPlainObject(confirmed) || !isPlainObject(remote)) return false;
  if (confirmed.presenceOnly === true) {
    return Boolean(
      !normalizeEpisodeIdentityScalar(remote.clinicalEpisodeId) &&
      !normalizeEpisodeIdentityScalar(remote.rut) &&
      !normalizeEpisodeIdentityScalar(remote.patientName)
    );
  }
  const confirmedEpisodeId = normalizeEpisodeIdentityScalar(confirmed.clinicalEpisodeId);
  const remoteEpisodeId = normalizeEpisodeIdentityScalar(remote.clinicalEpisodeId);
  if (confirmedEpisodeId || remoteEpisodeId) {
    return Boolean(confirmedEpisodeId && remoteEpisodeId && confirmedEpisodeId === remoteEpisodeId);
  }

  const confirmedRut = normalizeEpisodeIdentityScalar(confirmed.rut);
  const remoteRut = normalizeEpisodeIdentityScalar(remote.rut);
  const confirmedAnchor = normalizeEpisodeIdentityScalar(
    confirmed.firstSeenDate || confirmed.admissionDate
  );
  const remoteAnchor = normalizeEpisodeIdentityScalar(remote.firstSeenDate || remote.admissionDate);
  if (confirmedRut || remoteRut) {
    if (!confirmedRut || !remoteRut || confirmedRut !== remoteRut) return false;
    if (!confirmedAnchor || !remoteAnchor) return true;
    if (confirmedAnchor !== remoteAnchor) return false;
    const confirmedTime = normalizeEpisodeIdentityScalar(confirmed.admissionTime);
    const remoteTime = normalizeEpisodeIdentityScalar(remote.admissionTime);
    return !confirmedTime && !remoteTime ? true : confirmedTime === remoteTime;
  }

  const confirmedName = normalizeEpisodeIdentityScalar(confirmed.patientName);
  const remoteName = normalizeEpisodeIdentityScalar(remote.patientName);
  if (!confirmedName || confirmedName !== remoteName) return false;
  if (!confirmedAnchor && !remoteAnchor) return true;
  if (!confirmedAnchor || confirmedAnchor !== remoteAnchor) return false;
  const confirmedTime = normalizeEpisodeIdentityScalar(confirmed.admissionTime);
  const remoteTime = normalizeEpisodeIdentityScalar(remote.admissionTime);
  return !confirmedTime && !remoteTime ? true : confirmedTime === remoteTime;
};

const clonePlainValue = value => {
  if (Array.isArray(value)) {
    return value.map(clonePlainValue);
  }

  if (value instanceof Date || typeof value?.toDate === 'function') {
    return value;
  }

  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, nestedValue]) => [key, clonePlainValue(nestedValue)])
    );
  }

  return value;
};

const setValueAtPath = (target, path, value) => {
  const parts = String(path)
    .split('.')
    .map(part => part.trim())
    .filter(Boolean);

  if (parts.length === 0) {
    throw new functions.https.HttpsError(
      'invalid-argument',
      'Daily record patch paths must be non-empty dot paths.'
    );
  }
  if (parts.some(part => FORBIDDEN_PATCH_PATH_SEGMENTS.has(part))) {
    throw new functions.https.HttpsError(
      'invalid-argument',
      'Daily record patch path contains a forbidden segment.'
    );
  }

  let cursor = target;
  for (const part of parts.slice(0, -1)) {
    if (!isPlainObject(cursor[part])) {
      cursor[part] = {};
    }
    cursor = cursor[part];
  }

  cursor[parts[parts.length - 1]] = value === undefined ? null : clonePlainValue(value);
};

const applyPatchToRecord = ({ date, remoteData, patch }) => {
  const record = clonePlainValue(remoteData || {});
  Object.entries(patch).forEach(([path, value]) => setValueAtPath(record, path, value));
  record.date = date;
  return record;
};

// Campos derivados/históricos por cama que inflan el registro (~17KB, ~13KB y
// ~7,5KB por cama medidos): duplicarlos en cada snapshot de historial es
// cuadrático y no aporta a la auditoría del censo (viven en el registro vigente
// y/o son historiales por sí mismos).
const HEAVY_DERIVED_BED_FIELDS = [
  'clinicalSyncCheckpoint',
  'vitalSignsHistory',
  'evaluationScores',
];

const slimHistoryBed = bed => {
  if (!bed || typeof bed !== 'object' || Array.isArray(bed)) {
    return bed;
  }
  const copy = { ...bed };
  HEAVY_DERIVED_BED_FIELDS.forEach(field => {
    delete copy[field];
  });
  if (
    copy.clinicalCrib &&
    typeof copy.clinicalCrib === 'object' &&
    !Array.isArray(copy.clinicalCrib)
  ) {
    const crib = { ...copy.clinicalCrib };
    HEAVY_DERIVED_BED_FIELDS.forEach(field => {
      delete crib[field];
    });
    copy.clinicalCrib = crib;
  }
  return copy;
};

/**
 * Snapshot de historial adelgazado: conserva la foto auditable del censo
 * (identidad, camas, diagnóstico, movimientos) sin los campos derivados
 * pesados ni el historial Rayen embebido. Nadie lee estos snapshots
 * programáticamente (la restauración de versiones usa conflictSnapshots/).
 */
const buildSlimHistorySnapshot = (record, now) => {
  const beds = {};
  Object.entries(record.beds || {}).forEach(([bedId, bed]) => {
    beds[bedId] = slimHistoryBed(bed);
  });
  const snapshot = {
    ...record,
    beds,
    snapshotTimestamp: now,
    historyCompression: 'slim-v1',
  };
  delete snapshot.rayenSyncHistory;
  return snapshot;
};

const readValueAtPath = (record, path) =>
  String(path)
    .split('.')
    .reduce((current, segment) => {
      if (!current || typeof current !== 'object') return undefined;
      return current[segment];
    }, record);

const parseAuthorizedPatchPath = (
  path,
  role,
  guardedClinicalWrite = false,
  guardedRecordScope = 'run',
  intentionalBedClear = null
) => {
  const parts = String(path)
    .split('.')
    .map(part => part.trim())
    .filter(Boolean);

  if (
    intentionalBedClear &&
    path ===
      (intentionalBedClear.target === 'clinicalCrib'
        ? `beds.${intentionalBedClear.bedId}.clinicalCrib`
        : `beds.${intentionalBedClear.bedId}`) &&
    STRUCTURAL_DAILY_RECORD_PATCH_ROLES.has(role)
  ) {
    return {
      kind: 'structuralField',
      bedId: intentionalBedClear.bedId,
      field: intentionalBedClear.target === 'clinicalCrib' ? 'clinicalCrib' : 'bed',
    };
  }

  if (
    guardedClinicalWrite &&
    (isGuardedClinicalPatchPath(path, RAYEN_CLINICAL_PATCH_FIELDS) ||
      (guardedRecordScope === 'historical' && isHistoricalCudyrPatchPath(path)))
  ) {
    return {
      kind: 'rayenClinicalField',
      bedId: parts[1],
      field: parts[parts.length - 1],
    };
  }

  if (
    parts.length === 3 &&
    parts[0] === 'beds' &&
    !parts.some(part => FORBIDDEN_PATCH_PATH_SEGMENTS.has(part)) &&
    ALLOWED_DAILY_RECORD_PATCH_FIELDS.has(parts[2])
  ) {
    return {
      kind: 'patientField',
      bedId: parts[1],
      field: parts[2],
    };
  }

  if (
    parts.length === 2 &&
    parts[0] === 'bedTypeOverrides' &&
    !parts.some(part => FORBIDDEN_PATCH_PATH_SEGMENTS.has(part))
  ) {
    return {
      kind: 'bedTypeOverride',
      bedId: parts[1],
      field: 'bedTypeOverride',
    };
  }

  // Once policy schema v2 is active, Firestore deliberately fences the whole beds tree.
  // Admin/nurse structural edits are therefore authorized here and later merged while preserving
  // every server-owned clinical field. Other roles retain the narrow allowlist above.
  if (
    parts.length >= 3 &&
    parts[0] === 'beds' &&
    !parts.some(part => FORBIDDEN_PATCH_PATH_SEGMENTS.has(part)) &&
    STRUCTURAL_DAILY_RECORD_PATCH_ROLES.has(role)
  ) {
    return {
      kind: 'structuralField',
      bedId: parts[1],
      field: parts[parts.length - 1],
    };
  }

  throw new functions.https.HttpsError(
    'invalid-argument',
    `Daily record patch path is not allowed: ${String(path).slice(0, 120)}`
  );
};

const assertAuthorizedPatchValue = ({ path, value, parsedPath, patchPaths }) => {
  if (parsedPath.kind !== 'bedTypeOverride') {
    return;
  }

  if (!ALLOWED_DAILY_RECORD_BED_TYPE_OVERRIDE_VALUES.has(value)) {
    throw new functions.https.HttpsError(
      'invalid-argument',
      `Daily record bed type override value is not allowed: ${String(path).slice(0, 120)}`
    );
  }

  if (
    !patchPaths.has(`beds.${parsedPath.bedId}.upcChecklist`) &&
    !patchPaths.has(`beds.${parsedPath.bedId}.isUPC`)
  ) {
    throw new functions.https.HttpsError(
      'invalid-argument',
      `Daily record bed type override must accompany a UPC patch: ${String(path).slice(0, 120)}`
    );
  }
};

const inspectAuthorizedPatch = ({
  remoteData,
  patch,
  role,
  guardedClinicalWrite = false,
  guardedRecordScope = 'run',
  intentionalBedClear = null,
}) => {
  const patchPaths = new Set(Object.keys(patch));
  let requiresStructuralAuthority = false;
  Object.entries(patch).forEach(([path, value]) => {
    const parsedPath = parseAuthorizedPatchPath(
      path,
      role,
      guardedClinicalWrite,
      guardedRecordScope,
      intentionalBedClear
    );
    if (parsedPath.kind === 'structuralField') {
      const patient = remoteData?.beds?.[parsedPath.bedId];
      if (!isPlainObject(patient)) {
        throw new functions.https.HttpsError(
          'failed-precondition',
          `Daily record patch target bed is not present: ${parsedPath.bedId}`
        );
      }
      if (patient.isBlocked === true) {
        throw new functions.https.HttpsError(
          'failed-precondition',
          `Daily record patch target bed is blocked: ${parsedPath.bedId}`
        );
      }
      requiresStructuralAuthority = true;
      return;
    }
    assertAuthorizedPatchValue({ path, value, parsedPath, patchPaths });
    const { bedId } = parsedPath;
    const patient = remoteData?.beds?.[bedId];
    if (!isPlainObject(patient)) {
      throw new functions.https.HttpsError(
        'failed-precondition',
        `Daily record patch target bed is not present: ${bedId}`
      );
    }
    if (patient.isBlocked === true) {
      throw new functions.https.HttpsError(
        'failed-precondition',
        `Daily record patch target bed is blocked: ${bedId}`
      );
    }
    if (
      !patient.clinicalEpisodeId &&
      !patient.rut &&
      !patient.patientName &&
      !patient.admissionDate
    ) {
      throw new functions.https.HttpsError(
        'failed-precondition',
        `Daily record patch target bed has no active clinical episode identity: ${bedId}`
      );
    }
  });
  return { requiresStructuralAuthority };
};

const EMPTY_BED_STRING_FIELDS = new Set([
  'blockedReason',
  'patientName',
  'firstName',
  'lastName',
  'secondLastName',
  'rut',
  'age',
  'birthDate',
  'admissionOriginDetails',
  'pathology',
  'specialty',
  'status',
  'admissionDate',
  'admissionTime',
  'handoffNote',
  'handoffNoteDayShift',
  'handoffNoteNightShift',
  'medicalHandoffNote',
]);
const EMPTY_BED_FALSE_FIELDS = new Set([
  'isBlocked',
  'hasCompanionCrib',
  'isRapanui',
  'surgicalComplication',
  'isUPC',
]);
const EMPTY_BED_TRUE_FIELDS = new Set(['hasWristband']);
const EMPTY_BED_NULL_FIELDS = new Set([
  'clinicalCrib',
  'insurance',
  'admissionOrigin',
  'origin',
  'cie10Code',
  'cie10Description',
  'treatingPhysicianId',
  'treatingPhysicianName',
  'ginecobstetriciaType',
  'secondarySpecialty',
  'medicalHandoffAudit',
  'firstSeenDate',
  'deliveryRoute',
  'deliveryDate',
  'deliveryCesareanLabor',
]);
const EMPTY_BED_ARRAY_FIELDS = new Set(['devices', 'medicalHandoffEntries', 'clinicalEvents']);
const EMPTY_BED_OPTIONAL_EMPTY_STRING_FIELDS = new Set(['clinicalEpisodeId']);
const EMPTY_BED_ALLOWED_FIELDS = new Set([
  'bedId',
  'bedMode',
  'location',
  'identityStatus',
  'documentType',
  'biologicalSex',
  ...EMPTY_BED_STRING_FIELDS,
  ...EMPTY_BED_FALSE_FIELDS,
  ...EMPTY_BED_TRUE_FIELDS,
  ...EMPTY_BED_NULL_FIELDS,
  ...EMPTY_BED_ARRAY_FIELDS,
  ...EMPTY_BED_OPTIONAL_EMPTY_STRING_FIELDS,
]);

const buildCanonicalEmptyBed = ({ bedId, requestedBed, remoteBed }) => {
  if (!isPlainObject(remoteBed)) {
    throw new functions.https.HttpsError(
      'failed-precondition',
      'Intentional bed clear requires an existing remote bed.'
    );
  }
  const invalidField = Object.keys(requestedBed).find(
    field => !EMPTY_BED_ALLOWED_FIELDS.has(field)
  );
  const invalidEmptyString = [...EMPTY_BED_STRING_FIELDS].find(field => requestedBed[field] !== '');
  const invalidFalse = [...EMPTY_BED_FALSE_FIELDS].find(field => requestedBed[field] !== false);
  const invalidTrue = [...EMPTY_BED_TRUE_FIELDS].find(field => requestedBed[field] !== true);
  const invalidNull = [...EMPTY_BED_NULL_FIELDS].find(
    field => requestedBed[field] !== undefined && requestedBed[field] !== null
  );
  const invalidArray = [...EMPTY_BED_ARRAY_FIELDS].find(
    field => !Array.isArray(requestedBed[field]) || requestedBed[field].length !== 0
  );
  const invalidOptionalEmptyString = [...EMPTY_BED_OPTIONAL_EMPTY_STRING_FIELDS].find(
    field => requestedBed[field] !== undefined && requestedBed[field] !== ''
  );
  const remoteLocation = typeof remoteBed.location === 'string' ? remoteBed.location : null;
  const remoteBedMode =
    remoteBed.bedMode === 'Cama' || remoteBed.bedMode === 'Cuna' ? remoteBed.bedMode : null;
  if (
    invalidField ||
    invalidEmptyString ||
    invalidFalse ||
    invalidTrue ||
    invalidNull ||
    invalidArray ||
    invalidOptionalEmptyString ||
    requestedBed.bedId !== bedId ||
    !remoteBedMode ||
    requestedBed.bedMode !== remoteBedMode ||
    remoteLocation === null ||
    requestedBed.location !== remoteLocation ||
    requestedBed.identityStatus !== 'official' ||
    requestedBed.documentType !== 'RUT' ||
    requestedBed.biologicalSex !== 'Indeterminado'
  ) {
    throw new functions.https.HttpsError(
      'invalid-argument',
      'Intentional bed clear must use the canonical empty-bed shape.'
    );
  }

  return {
    bedId,
    isBlocked: false,
    blockedReason: '',
    bedMode: remoteBedMode,
    hasCompanionCrib: false,
    clinicalCrib: null,
    patientName: '',
    firstName: '',
    lastName: '',
    secondLastName: '',
    identityStatus: 'official',
    rut: '',
    clinicalEpisodeId: '',
    documentType: 'RUT',
    age: '',
    birthDate: '',
    biologicalSex: 'Indeterminado',
    insurance: null,
    admissionOrigin: null,
    admissionOriginDetails: '',
    origin: null,
    isRapanui: false,
    pathology: '',
    cie10Code: null,
    cie10Description: null,
    treatingPhysicianId: null,
    treatingPhysicianName: null,
    specialty: '',
    ginecobstetriciaType: null,
    secondarySpecialty: null,
    status: '',
    admissionDate: '',
    admissionTime: '',
    hasWristband: true,
    devices: [],
    surgicalComplication: false,
    isUPC: false,
    location: remoteLocation,
    handoffNote: '',
    handoffNoteDayShift: '',
    handoffNoteNightShift: '',
    medicalHandoffNote: '',
    medicalHandoffAudit: null,
    medicalHandoffEntries: [],
    clinicalEvents: [],
    firstSeenDate: null,
    deliveryRoute: null,
    deliveryDate: null,
    deliveryCesareanLabor: null,
  };
};

const assertIntentionalBedClearRequest = ({
  patch,
  role,
  expectedLastUpdated,
  intentionalBedClear,
  remoteData,
}) => {
  if (!intentionalBedClear) return null;
  if (!STRUCTURAL_DAILY_RECORD_PATCH_ROLES.has(role)) {
    throw new functions.https.HttpsError(
      'permission-denied',
      'Only an administrator or hospital nurse can clear an occupied bed.'
    );
  }
  if (!normalizeShortString(expectedLastUpdated)) {
    throw new functions.https.HttpsError(
      'failed-precondition',
      'Intentional bed clear requires an exact census version.'
    );
  }
  if (toMillis(intentionalBedClear.confirmedLastUpdated) !== toMillis(expectedLastUpdated)) {
    throw new functions.https.HttpsError(
      'aborted',
      'Intentional bed clear no longer matches the census version confirmed by the user.'
    );
  }
  const remoteBed = remoteData?.beds?.[intentionalBedClear.bedId];
  const remoteOccupant =
    intentionalBedClear.target === 'clinicalCrib' ? remoteBed?.clinicalCrib : remoteBed;
  if (
    intentionalBedClear.confirmedOccupant &&
    !sameConfirmedBedEpisode(intentionalBedClear.confirmedOccupant, remoteOccupant)
  ) {
    throw new functions.https.HttpsError(
      'aborted',
      'Intentional bed clear no longer targets the occupant confirmed by the user.'
    );
  }
  if (intentionalBedClear.target === 'bed') {
    const remoteAssociatedCrib = remoteBed?.clinicalCrib;
    const confirmedAssociatedCrib = intentionalBedClear.confirmedAssociatedCrib;
    if (confirmedAssociatedCrib === undefined && isPlainObject(remoteAssociatedCrib)) {
      throw new functions.https.HttpsError(
        'failed-precondition',
        'Intentional bed clear requires confirming the associated clinical crib.'
      );
    }
    if (
      confirmedAssociatedCrib?.presenceOnly === true &&
      toMillis(remoteData?.lastUpdated) !== toMillis(intentionalBedClear.confirmedLastUpdated)
    ) {
      throw new functions.https.HttpsError(
        'aborted',
        'Presence-only clinical crib confirmation requires the exact census version.'
      );
    }
    if (
      (confirmedAssociatedCrib === null && isPlainObject(remoteAssociatedCrib)) ||
      (isPlainObject(confirmedAssociatedCrib) &&
        !sameConfirmedBedEpisode(confirmedAssociatedCrib, remoteAssociatedCrib))
    ) {
      throw new functions.https.HttpsError(
        'aborted',
        'The associated clinical crib changed after the bed clear was confirmed.'
      );
    }
  }
  const bedPath = `beds.${intentionalBedClear.bedId}`;
  const expectedPath =
    intentionalBedClear.target === 'clinicalCrib' ? `${bedPath}.clinicalCrib` : bedPath;
  const paths = Object.keys(patch);
  const requestedTarget = patch[expectedPath];
  if (
    paths.length !== 1 ||
    paths[0] !== expectedPath ||
    (intentionalBedClear.target === 'clinicalCrib'
      ? requestedTarget !== null && requestedTarget !== undefined
      : !isPlainObject(requestedTarget))
  ) {
    throw new functions.https.HttpsError(
      'invalid-argument',
      intentionalBedClear.target === 'clinicalCrib'
        ? 'Intentional crib clear must remove exactly one matching clinical crib.'
        : 'Intentional bed clear must replace exactly one matching bed with an empty patient.'
    );
  }
  if (intentionalBedClear.target === 'clinicalCrib') {
    if (!isPlainObject(remoteOccupant)) {
      throw new functions.https.HttpsError(
        'failed-precondition',
        'Intentional crib clear requires an existing remote clinical crib.'
      );
    }
    return { [expectedPath]: null };
  }
  const canonicalBed = buildCanonicalEmptyBed({
    bedId: intentionalBedClear.bedId,
    requestedBed: requestedTarget,
    remoteBed,
  });
  return { [expectedPath]: canonicalBed };
};

// Solo los campos EXCLUSIVOS del lote (mediciones y checkpoint) quedan
// vallados para parches directos: los dispositivos (devices/deviceDetails/
// deviceInstanceHistory) son datos operacionales que enfermería gestiona a
// mano entre corridas — vallarlos dejaba «agregar LA/SNG» guardando solo en
// local y perdiéndose al recargar (verificado en vivo 31-08). El canal
// guardado del lote (rayenClinicalWriteGuard) sigue escribiendo el conjunto
// completo.
const RAYEN_FENCED_PATCH_FIELDS = new Set(RAYEN_BATCH_ONLY_CLINICAL_FIELDS);

const isRayenClinicalOwnedPatchPath = path => {
  const parts = String(path)
    .split('.')
    .map(part => part.trim())
    .filter(Boolean);
  if (parts[0] !== 'beds' || !parts[1]) return false;
  if (RAYEN_FENCED_PATCH_FIELDS.has(parts[2])) return true;
  return parts[2] === 'clinicalCrib' && RAYEN_FENCED_PATCH_FIELDS.has(parts[3]);
};

const assertNoRayenClinicalOwnedPatch = patch => {
  if (!Object.keys(patch).some(isRayenClinicalOwnedPatchPath)) return;
  throw new functions.https.HttpsError(
    'failed-precondition',
    'Rayen clinical fields must be written through the authoritative clinical batch.'
  );
};

const toCalendarDayOrdinal = value => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return undefined;
  const ordinal = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isFinite(ordinal) ? ordinal : undefined;
};

const currentRapaNuiCalendarDay = () => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Pacific/Easter',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
    .formatToParts(new Date())
    .reduce((result, part) => ({ ...result, [part.type]: part.value }), {});
  return `${parts.year}-${parts.month}-${parts.day}`;
};

const isNurseStructuralEditWithinWindow = ({ date, remoteData }) => {
  const recordTimestamp = Number(remoteData?.dateTimestamp);
  const now = Date.now();
  if (remoteData?.dateTimestamp != null && Number.isFinite(recordTimestamp)) {
    return now > recordTimestamp - 86_400_000 && now < recordTimestamp + 172_800_000;
  }

  const recordDay = toCalendarDayOrdinal(date);
  const currentDay = toCalendarDayOrdinal(currentRapaNuiCalendarDay());
  if (recordDay === undefined || currentDay === undefined) return false;
  const dayOffset = Math.round((recordDay - currentDay) / 86_400_000);
  return dayOffset >= -1 && dayOffset <= 1;
};

const assertStructuralPatchPolicy = ({ date, policySnapshot, remoteData, role }) => {
  if (!isRayenClinicalWriteFenceActive(policySnapshot)) {
    throw new functions.https.HttpsError(
      'failed-precondition',
      'Structural daily record patches require the schema-v2 server clinical authority fence.'
    );
  }

  if (role !== 'nurse_hospital') {
    return;
  }

  if (!isNurseStructuralEditWithinWindow({ date, remoteData })) {
    throw new functions.https.HttpsError(
      'permission-denied',
      'The nurse editing window for this daily record has closed.'
    );
  }
};

const assertFullRecordWritePolicy = ({ date, snapshot, record, role }) => {
  if (!snapshot.exists) {
    if (role === 'admin' || role === 'nurse_hospital') return;
    throw new functions.https.HttpsError(
      'permission-denied',
      'Only administrators and hospital nurses can create daily records.'
    );
  }

  if (role === 'admin') return;
  if (
    role === 'nurse_hospital' &&
    Number.isFinite(Number(record?.dateTimestamp)) &&
    isNurseStructuralEditWithinWindow({ date, remoteData: record })
  ) {
    return;
  }

  throw new functions.https.HttpsError(
    'permission-denied',
    role === 'nurse_hospital'
      ? 'The nurse editing window for this daily record has closed.'
      : 'This role must use its scoped daily-record write operation.'
  );
};

const collectChangedPaths = syncContract =>
  Array.isArray(syncContract?.changedPaths)
    ? syncContract.changedPaths
        .filter(path => typeof path === 'string' && path.trim())
        .map(path => path.trim())
    : [];

const resolveCurrentRevision = record => {
  const revision = Number(record?.meta?.revision);
  return Number.isFinite(revision) && revision >= 0 ? revision : 0;
};

const resolveBaseRevision = syncContract => {
  if (
    syncContract?.baseRevision === null ||
    syncContract?.baseRevision === undefined ||
    syncContract?.baseRevision === ''
  ) {
    return undefined;
  }
  const revision = Number(syncContract?.baseRevision);
  return Number.isInteger(revision) && revision >= 0 ? revision : undefined;
};

const assertExpectedRevision = ({ snapshot, syncContract }) => {
  const baseRevision = resolveBaseRevision(syncContract);
  if (baseRevision === undefined || !snapshot.exists) {
    return;
  }

  const currentRevision = resolveCurrentRevision(snapshot.data());
  if (currentRevision !== baseRevision) {
    throw new functions.https.HttpsError(
      'aborted',
      `revision_mismatch: Daily record base revision ${baseRevision} does not match remote revision ${currentRevision}.`
    );
  }
};

const buildNextMeta = ({ remoteData, syncContract, now }) => {
  const mutationId = normalizeShortString(syncContract?.mutationId);
  const clientId = normalizeShortString(syncContract?.clientId);
  const tabId = normalizeShortString(syncContract?.tabId);

  return {
    ...(isPlainObject(remoteData?.meta) ? clonePlainValue(remoteData.meta) : {}),
    revision: resolveCurrentRevision(remoteData) + 1,
    lastMutationId: mutationId || null,
    lastWriterClientId: clientId || null,
    lastWriterTabId: tabId || null,
    lastChangedPaths: collectChangedPaths(syncContract),
    updatedAt: now,
  };
};

const toMillis = value => {
  if (!value) return 0;
  if (typeof value.toDate === 'function') return value.toDate().getTime();
  const millis = new Date(value).getTime();
  return Number.isFinite(millis) ? millis : 0;
};

const toIsoTimestamp = value => {
  if (!value) return undefined;
  if (typeof value.toDate === 'function') return value.toDate().toISOString();
  if (Number.isFinite(value.seconds)) {
    return new Date(
      value.seconds * 1000 + Math.floor((value.nanoseconds || 0) / 1e6)
    ).toISOString();
  }
  const millis = new Date(value).getTime();
  return Number.isFinite(millis) ? new Date(millis).toISOString() : undefined;
};

const toClientRecordValue = value => {
  if (Array.isArray(value)) {
    return value.map(toClientRecordValue);
  }

  const timestamp = toIsoTimestamp(value);
  if (
    value instanceof Date ||
    typeof value?.toDate === 'function' ||
    Number.isFinite(value?.seconds)
  ) {
    return timestamp;
  }

  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, nestedValue]) => [key, toClientRecordValue(nestedValue)])
    );
  }

  return value;
};

const buildAuthorityRecordState = ({ record, lastUpdated, meta }) => {
  const normalizedLastUpdated = toIsoTimestamp(lastUpdated);
  if (!normalizedLastUpdated || !isPlainObject(meta) || !isPlainObject(record)) return undefined;
  const normalizedMeta = {
    ...toClientRecordValue(meta),
    updatedAt: toIsoTimestamp(meta.updatedAt) || normalizedLastUpdated,
  };
  return {
    lastUpdated: normalizedLastUpdated,
    meta: normalizedMeta,
    record: toClientRecordValue({
      ...record,
      lastUpdated: normalizedLastUpdated,
      meta: normalizedMeta,
    }),
  };
};

const assertExpectedVersion = ({ snapshot, expectedLastUpdated }) => {
  if (!expectedLastUpdated || !snapshot.exists) {
    return;
  }

  const remoteLastUpdated = snapshot.data()?.lastUpdated;
  if (!remoteLastUpdated) {
    return;
  }

  const remoteMillis = toMillis(remoteLastUpdated);
  const expectedMillis = toMillis(expectedLastUpdated);
  if (remoteMillis > expectedMillis) {
    throw new functions.https.HttpsError(
      'aborted',
      'Daily record changed remotely before the authorized write transaction.'
    );
  }
};

const assertExactExpectedVersion = ({ snapshot, expectedLastUpdated }) => {
  if (!snapshot.exists || !expectedLastUpdated) {
    throw new functions.https.HttpsError(
      'aborted',
      'Rayen clinical guarded writes require an exact remote version.'
    );
  }
  if (toMillis(snapshot.data()?.lastUpdated) !== toMillis(expectedLastUpdated)) {
    throw new functions.https.HttpsError(
      'aborted',
      'Daily record changed before the guarded Rayen clinical write.'
    );
  }
};

const hasAlreadyAppliedMutation = ({ snapshot, syncContract }) => {
  if (!snapshot.exists) {
    return false;
  }

  const remoteMutationId = normalizeShortString(snapshot.data()?.meta?.lastMutationId);
  const localMutationId = normalizeShortString(syncContract?.mutationId);
  return Boolean(remoteMutationId && localMutationId && remoteMutationId === localMutationId);
};

const assertClinicalAuthority = record => {
  const result = evaluateDailyRecordClinicalAuthority(record);
  return result;
};

const parsePayload = data => {
  const date = assertStringField(data?.date, 'date');
  const record = data?.record;
  if (!isPlainObject(record)) {
    throw new functions.https.HttpsError(
      'invalid-argument',
      'Daily record payload must be an object.'
    );
  }

  if (record.date !== date) {
    throw new functions.https.HttpsError(
      'invalid-argument',
      'Daily record payload date does not match request date.'
    );
  }

  return {
    date,
    record,
    mode: normalizeMode(data?.mode),
    origin: normalizeOrigin(data?.origin),
    dryRun: data?.dryRun === true,
    syncContract: isPlainObject(data?.syncContract) ? data.syncContract : undefined,
    expectedLastUpdated:
      typeof data?.expectedLastUpdated === 'string' ? data.expectedLastUpdated : undefined,
  };
};

const parsePatchPayload = data => {
  const date = assertStringField(data?.date, 'date');
  const patch = data?.patch;
  const syncContract = isPlainObject(data?.syncContract) ? data.syncContract : undefined;
  if (!isPlainObject(patch) || Object.keys(patch).length === 0) {
    throw new functions.https.HttpsError(
      'invalid-argument',
      'Daily record patch payload must be a non-empty object.'
    );
  }

  return {
    date,
    patch,
    mode: normalizeMode(data?.mode),
    origin: normalizeOrigin(data?.origin, 'direct_partial_update'),
    dryRun: data?.dryRun === true,
    syncContract,
    rayenClinicalWriteGuard: parseRayenClinicalWriteGuard(data?.rayenClinicalWriteGuard),
    intentionalBedClear: parseIntentionalBedClear(data?.intentionalBedClear),
    historyPolicy: data?.historyPolicy === 'skip' ? 'skip' : 'snapshot',
    expectedLastUpdated:
      typeof data?.expectedLastUpdated === 'string'
        ? data.expectedLastUpdated
        : typeof syncContract?.expectedVersion === 'string'
          ? syncContract.expectedVersion
          : undefined,
  };
};

const buildAuthorityResponse = ({
  date,
  mode,
  authority,
  coverage,
  revision,
  mutationId,
  recordState,
}) => {
  const response = {
    success: authority.status === 'ok' || authority.status === 'idempotent',
    date,
    mode,
    authorityStatus: authority.status,
    coverage,
    violations: authority.violations.map(violation => ({
      type: violation.type,
      path: violation.path,
      bedId: violation.bedId,
    })),
  };

  if (Number.isFinite(revision)) {
    response.revision = revision;
  }
  if (mutationId) {
    response.mutationId = mutationId;
  }
  if (recordState) {
    response.recordState = recordState;
  }

  return response;
};

const emptyCoverage = {
  activePatients: 0,
  canonicalEpisodeIds: 0,
  fallbackEpisodeKeys: 0,
  degenerateFallbackEpisodeKeys: 0,
};

const emptyAuthority = {
  status: 'blocked',
  violations: [],
};

const idempotentAuthority = {
  status: 'idempotent',
  violations: [],
};

const recordAuthorityTelemetry = async ({
  firestore,
  date,
  mode,
  origin,
  dryRun,
  authority,
  coverage,
  syncContract,
  status,
  operation = 'saveDailyRecordWithClinicalAuthority',
  errorCode,
  errorMessage,
  startedAt,
  timings,
}) => {
  try {
    const changedPaths = collectChangedPaths(syncContract);
    const safeAuthority = authority || emptyAuthority;
    const safeCoverage = coverage || emptyCoverage;
    await firestore
      .collection('hospitals')
      .doc(HOSPITAL_ID)
      .collection('functionsTelemetry')
      .add({
        service: 'dailyRecordWriteAuthority',
        operation,
        hospitalId: HOSPITAL_ID,
        durationMs: Date.now() - startedAt,
        // Fases del handler: separa autenticación, transacción (con reintentos)
        // e historial post-commit para poder atacar la tajada dominante.
        timings: timings || null,
        attempt: 1,
        totalAttempts: 1,
        status,
        // Firestore rechaza undefined: en éxito estos campos no existen y el
        // .add() fallaba silenciosamente — por eso nunca hubo telemetría de éxito.
        errorCode: errorCode ?? null,
        errorMessage: errorMessage ?? null,
        timestamp: new Date().toISOString(),
        context: {
          date,
          mode,
          origin,
          dryRun,
          authorityStatus: safeAuthority.status,
          violationCount: safeAuthority.violations.length,
          violationTypes: safeAuthority.violations.map(violation => violation.type).join(','),
          changedPathsCount: changedPaths.length,
          hasExpectedVersion: Boolean(syncContract?.expectedVersion),
          mutationId: normalizeShortString(syncContract?.mutationId) || null,
          activePatients: safeCoverage.activePatients,
          canonicalEpisodeIds: safeCoverage.canonicalEpisodeIds,
          fallbackEpisodeKeys: safeCoverage.fallbackEpisodeKeys,
          degenerateFallbackEpisodeKeys: safeCoverage.degenerateFallbackEpisodeKeys,
        },
      });
  } catch (error) {
    console.warn(
      'Failed to record daily record authority telemetry',
      sanitizeLogValue({ date, error })
    );
  }
};

const assertAuthorizedDailyRecordWriter = async ({
  context,
  resolveRoleForEmail,
  requiredRole,
}) => {
  const email = requireAuthenticatedEmail(context);
  const resolvedRole = await resolveRoleForEmail(email);

  if (requiredRole && resolvedRole !== requiredRole) {
    throw new functions.https.HttpsError(
      'permission-denied',
      'This daily-record operation requires an administrator.'
    );
  }
  if (!ALLOWED_DAILY_RECORD_WRITE_ROLES.has(resolvedRole)) {
    throw new functions.https.HttpsError(
      'permission-denied',
      'Only authorized clinical users can save daily records.'
    );
  }

  return { email, role: resolvedRole };
};

const assertNoPatientErasures = ({ snapshot, record, intentionalBedClear = null }) => {
  if (!snapshot.exists) {
    return;
  }
  const erasures = findPatientErasures(snapshot.data() || {}, record).filter(erasure => {
    if (!intentionalBedClear) return true;
    if (intentionalBedClear.target === 'clinicalCrib') {
      return erasure.bedId !== `${intentionalBedClear.bedId} (cuna RN)`;
    }
    return (
      erasure.bedId !== intentionalBedClear.bedId &&
      erasure.bedId !== `${intentionalBedClear.bedId} (cuna RN)`
    );
  });
  if (erasures.length === 0) {
    return;
  }
  const detail = erasures
    .map(erasure => `${erasure.bedId} (${erasure.remotePatientName})`)
    .join(', ');
  throw new functions.https.HttpsError(
    'failed-precondition',
    `La cama ${detail} tiene un paciente en la nube pero está vacía en la copia entrante. ` +
      'El guardado fue bloqueado para evitar pérdida de datos.'
  );
};

const createDailyRecordWriteAuthorityFunctions = ({
  firestore,
  Timestamp,
  resolveRoleForEmail,
}) => ({
  saveDailyRecordWithClinicalAuthority: functions
    // Cerca de Firestore (Firestore: southamerica-west1; Gen1 no existe en esa
    // región, así que se usa southamerica-east1): la transacción y el historial
    // mueven el registro completo y us-central1 costaba un cruce de continente.
    // Debe coincidir con DAILY_RECORD_AUTHORITY_FUNCTIONS_REGION del cliente.
    .region('southamerica-east1', 'us-central1')
    .runWith({ memory: '1GB' })
    .https.onCall(async (data, context) => {
      const startedAt = Date.now();
      const { email, role } = await assertAuthorizedDailyRecordWriter({
        context,
        resolveRoleForEmail,
      });
      const authMs = Date.now() - startedAt;
      let txnStartedAt = 0;
      let txnMs = 0;
      let txnAttempts = 0;
      let historyMs = 0;
      let pendingHistoryData = null;
      const buildTimings = () => ({
        authMs,
        txnMs: txnMs || (txnStartedAt ? Date.now() - txnStartedAt : 0),
        txnAttempts,
        historyMs,
      });

      const { date, record, expectedLastUpdated, mode, origin, dryRun, syncContract } =
        parsePayload(data);
      const authority = assertClinicalAuthority(record);
      const coverage = collectClinicalEpisodeCoverage(record);

      if (authority.status !== 'ok') {
        await recordAuthorityTelemetry({
          firestore,
          date,
          mode,
          origin,
          dryRun,
          authority,
          coverage,
          syncContract,
          status: 'failure',
          errorCode: 'failed-precondition',
          errorMessage: 'Daily record clinical authority blocked write.',
          startedAt,
        });
        throw new functions.https.HttpsError(
          'failed-precondition',
          authority.violations.map(violation => violation.message).join(' ')
        );
      }

      const db = firestore;
      const hospitalRef = db.collection('hospitals').doc(HOSPITAL_ID);
      const docRef = hospitalRef.collection('dailyRecords').doc(date);
      const policyRef = hospitalRef.collection('settings').doc('rayenImportPolicy');
      let revision;
      let recordState;
      let responseAuthority = authority;
      let responseCoverage = coverage;

      try {
        txnStartedAt = Date.now();
        await db.runTransaction(async transaction => {
          txnAttempts += 1;
          pendingHistoryData = null;
          const snapshot = await transaction.get(docRef);
          if (hasAlreadyAppliedMutation({ snapshot, syncContract })) {
            const remoteData = snapshot.data() || {};
            responseAuthority = idempotentAuthority;
            responseCoverage = collectClinicalEpisodeCoverage(remoteData);
            revision = resolveCurrentRevision(remoteData);
            recordState = buildAuthorityRecordState({
              record: remoteData,
              lastUpdated: remoteData.lastUpdated,
              meta: remoteData.meta,
            });
            return;
          }

          assertFullRecordWritePolicy({ date, snapshot, record, role });

          assertExpectedVersion({ snapshot, expectedLastUpdated });
          assertExpectedRevision({ snapshot, syncContract });
          assertNoPatientErasures({ snapshot, record });

          const policySnapshot = await transaction.get(policyRef);
          const remoteData = snapshot.exists ? snapshot.data() || {} : {};
          const recordForPersistence = isRayenClinicalWriteFenceActive(policySnapshot)
            ? preserveRayenClinicalFields({ remoteRecord: remoteData, incomingRecord: record })
            : record;
          responseAuthority = assertClinicalAuthority(recordForPersistence);
          responseCoverage = collectClinicalEpisodeCoverage(recordForPersistence);
          if (responseAuthority.status !== 'ok') {
            throw new functions.https.HttpsError(
              'failed-precondition',
              responseAuthority.violations.map(violation => violation.message).join(' ')
            );
          }

          if (dryRun) {
            return;
          }

          const now = Timestamp.now();
          if (snapshot.exists) {
            // El snapshot de historial se escribe DESPUÉS del commit y adelgazado:
            // dentro de la transacción duplicaba el payload del registro completo
            // y alargaba cada escritura autoritativa sin proteger ningún invariante.
            pendingHistoryData = buildSlimHistorySnapshot(snapshot.data() || {}, now);
          }

          const nextMeta = buildNextMeta({
            remoteData,
            syncContract,
            now,
          });
          revision = nextMeta.revision;
          recordState = buildAuthorityRecordState({
            record: recordForPersistence,
            lastUpdated: now,
            meta: nextMeta,
          });
          transaction.set(docRef, {
            ...recordForPersistence,
            meta: nextMeta,
            lastUpdated: now,
          });
        });
        txnMs = Date.now() - txnStartedAt;

        if (pendingHistoryData) {
          const historyStartedAt = Date.now();
          try {
            await docRef
              .collection('history')
              .doc(new Date().toISOString())
              .set(pendingHistoryData);
          } catch (historyError) {
            console.error(
              'Daily record history snapshot failed after commit',
              sanitizeLogValue({ date, error: historyError })
            );
          }
          historyMs = Date.now() - historyStartedAt;
        }

        await recordAuthorityTelemetry({
          firestore,
          date,
          mode,
          origin,
          dryRun,
          authority: responseAuthority,
          coverage: responseCoverage,
          syncContract,
          status: 'success',
          startedAt,
          timings: buildTimings(),
        });

        return buildAuthorityResponse({
          date,
          mode,
          authority: responseAuthority,
          coverage: responseCoverage,
          revision,
          mutationId: normalizeShortString(syncContract?.mutationId),
          recordState,
        });
      } catch (error) {
        if (error instanceof functions.https.HttpsError) {
          await recordAuthorityTelemetry({
            firestore,
            date,
            mode,
            origin,
            dryRun,
            authority,
            coverage,
            syncContract,
            status: 'failure',
            errorCode: error.code,
            errorMessage: error.message,
            startedAt,
            timings: buildTimings(),
          });
          throw error;
        }

        console.error(
          'Error saving daily record with clinical authority',
          sanitizeLogValue({ email, date, error })
        );
        throw new functions.https.HttpsError(
          'internal',
          'Failed to save daily record with clinical authority.'
        );
      }
    }),

  patchDailyRecordWithClinicalAuthority: functions
    .region('southamerica-east1', 'us-central1')
    .runWith({ memory: '1GB' })
    .https.onCall(async (data, context) => {
      const startedAt = Date.now();
      const { email, role } = await assertAuthorizedDailyRecordWriter({
        context,
        resolveRoleForEmail,
      });
      const authMs = Date.now() - startedAt;
      let txnStartedAt = 0;
      let txnMs = 0;
      let txnAttempts = 0;
      let historyMs = 0;
      let pendingHistoryData = null;
      const buildTimings = () => ({
        authMs,
        txnMs: txnMs || (txnStartedAt ? Date.now() - txnStartedAt : 0),
        txnAttempts,
        historyMs,
      });
      const {
        date,
        patch,
        mode,
        origin,
        dryRun,
        syncContract,
        expectedLastUpdated,
        rayenClinicalWriteGuard,
        intentionalBedClear,
      } = parsePatchPayload(data);
      const db = firestore;
      const hospitalRef = db.collection('hospitals').doc(HOSPITAL_ID);
      const docRef = hospitalRef.collection('dailyRecords').doc(date);
      const policyRef = hospitalRef.collection('settings').doc('rayenImportPolicy');
      const sourceRef =
        rayenClinicalWriteGuard?.recordScope === 'historical'
          ? hospitalRef.collection('dailyRecords').doc(rayenClinicalWriteGuard.sourceDate)
          : docRef;
      let authority;
      let coverage;
      let revision;
      let recordState;
      const mutationId = normalizeShortString(syncContract?.mutationId);
      const guardedHistoryRef = rayenClinicalWriteGuard
        ? docRef.collection('history').doc(`rayen-${rayenClinicalWriteGuard.runId}`)
        : null;

      try {
        txnStartedAt = Date.now();
        await db.runTransaction(async transaction => {
          txnAttempts += 1;
          pendingHistoryData = null;
          const [snapshot, policySnapshot, sourceSnapshot, guardedHistorySnapshot] =
            await Promise.all([
              transaction.get(docRef),
              transaction.get(policyRef),
              rayenClinicalWriteGuard?.recordScope === 'historical'
                ? transaction.get(sourceRef)
                : Promise.resolve(null),
              guardedHistoryRef ? transaction.get(guardedHistoryRef) : Promise.resolve(null),
            ]);
          if (!snapshot.exists) {
            throw new functions.https.HttpsError(
              'failed-precondition',
              'Daily record partial patch requires an existing record.'
            );
          }

          const remoteData = snapshot.data() || {};
          if (hasAlreadyAppliedMutation({ snapshot, syncContract })) {
            authority = idempotentAuthority;
            coverage = collectClinicalEpisodeCoverage(remoteData);
            revision = resolveCurrentRevision(remoteData);
            recordState = buildAuthorityRecordState({
              record: remoteData,
              lastUpdated: remoteData.lastUpdated,
              meta: remoteData.meta,
            });
            return;
          }

          if (rayenClinicalWriteGuard || intentionalBedClear) {
            assertExactExpectedVersion({ snapshot, expectedLastUpdated });
          } else {
            assertExpectedVersion({ snapshot, expectedLastUpdated });
          }
          assertExpectedRevision({ snapshot, syncContract });
          if (rayenClinicalWriteGuard) {
            assertGuardedClinicalPatch({
              patch,
              clinicalFields: RAYEN_CLINICAL_PATCH_FIELDS,
              recordScope: rayenClinicalWriteGuard.recordScope,
            });
            const runRecord =
              rayenClinicalWriteGuard.recordScope === 'historical'
                ? sourceSnapshot?.exists
                  ? sourceSnapshot.data() || {}
                  : null
                : remoteData;
            assertRayenLegacyClinicalWriteAuthority({
              policySnapshot,
              runRecord,
              targetDate: date,
              guard: rayenClinicalWriteGuard,
              role,
            });
          }
          const canonicalIntentionalBedClearPatch = assertIntentionalBedClearRequest({
            patch,
            role,
            expectedLastUpdated,
            intentionalBedClear,
            remoteData,
          });
          const authorizedPatch = canonicalIntentionalBedClearPatch || patch;
          const patchInspection = inspectAuthorizedPatch({
            remoteData,
            patch: authorizedPatch,
            role,
            guardedClinicalWrite: Boolean(rayenClinicalWriteGuard),
            guardedRecordScope: rayenClinicalWriteGuard?.recordScope,
            intentionalBedClear,
          });
          if (
            isRayenClinicalWriteFenceActive(policySnapshot) &&
            !rayenClinicalWriteGuard &&
            !intentionalBedClear
          ) {
            assertNoRayenClinicalOwnedPatch(patch);
          }
          if (patchInspection.requiresStructuralAuthority) {
            assertStructuralPatchPolicy({ date, policySnapshot, remoteData, role });
          }
          const now = Timestamp.now();
          const patchedCandidate = applyPatchToRecord({
            date,
            remoteData,
            patch: authorizedPatch,
          });
          const patchedRecord =
            isRayenClinicalWriteFenceActive(policySnapshot) &&
            !rayenClinicalWriteGuard &&
            !intentionalBedClear
              ? preserveRayenClinicalFields({
                  remoteRecord: remoteData,
                  incomingRecord: patchedCandidate,
                  // Los dispositivos editados a mano ya pasaron la valla: solo
                  // se restauran las mediciones exclusivas del lote.
                  fields: RAYEN_BATCH_ONLY_CLINICAL_FIELDS,
                })
              : patchedCandidate;
          assertNoPatientErasures({
            snapshot,
            record: patchedRecord,
            intentionalBedClear,
          });
          patchedRecord.meta = buildNextMeta({ remoteData, syncContract, now });

          authority = assertClinicalAuthority(patchedRecord);
          coverage = collectClinicalEpisodeCoverage(patchedRecord);
          revision = patchedRecord.meta.revision;
          recordState = buildAuthorityRecordState({
            record: patchedRecord,
            lastUpdated: now,
            meta: patchedRecord.meta,
          });

          if (authority.status !== 'ok') {
            throw new functions.https.HttpsError(
              'failed-precondition',
              authority.violations.map(violation => violation.message).join(' ')
            );
          }

          if (dryRun) {
            return;
          }

          if (guardedHistoryRef) {
            if (!guardedHistorySnapshot?.exists) {
              transaction.set(guardedHistoryRef, buildSlimHistorySnapshot(remoteData, now));
            }
          } else {
            // El snapshot de historial se escribe DESPUÉS del commit y adelgazado:
            // dentro de la transacción duplicaba el payload del registro completo
            // y alargaba cada comando cama–cuna sin proteger ningún invariante.
            pendingHistoryData = buildSlimHistorySnapshot(remoteData, now);
          }

          // Escribir sólo los paths tocados (con sus valores FINALES, ya
          // canonicalizados en patchedRecord) en lugar de reescribir el registro
          // completo (~0,5MB): el documento resultante es idéntico al set()
          // anterior y el payload de la transacción baja de cientos de KB a KBs.
          const txnUpdate = { date, meta: patchedRecord.meta, lastUpdated: now };
          Object.keys(authorizedPatch).forEach(path => {
            const finalValue = readValueAtPath(patchedRecord, path);
            txnUpdate[path] = finalValue === undefined ? null : finalValue;
          });
          transaction.update(docRef, txnUpdate);
        });
        txnMs = Date.now() - txnStartedAt;

        if (pendingHistoryData) {
          const historyStartedAt = Date.now();
          try {
            await docRef
              .collection('history')
              .doc(new Date().toISOString())
              .set(pendingHistoryData);
          } catch (historyError) {
            console.error(
              'Daily record history snapshot failed after commit',
              sanitizeLogValue({ date, error: historyError })
            );
          }
          historyMs = Date.now() - historyStartedAt;
        }

        await recordAuthorityTelemetry({
          firestore,
          date,
          mode,
          origin,
          dryRun,
          authority,
          coverage,
          syncContract,
          operation: 'patchDailyRecordWithClinicalAuthority',
          status: 'success',
          startedAt,
          timings: buildTimings(),
        });

        return buildAuthorityResponse({
          date,
          mode,
          authority,
          coverage,
          revision,
          mutationId,
          recordState,
        });
      } catch (error) {
        if (error instanceof functions.https.HttpsError) {
          await recordAuthorityTelemetry({
            firestore,
            date,
            mode,
            origin,
            dryRun,
            authority,
            coverage,
            syncContract,
            operation: 'patchDailyRecordWithClinicalAuthority',
            status: 'failure',
            errorCode: error.code,
            errorMessage: error.message,
            startedAt,
            timings: buildTimings(),
          });
          throw error;
        }

        console.error(
          'Error patching daily record with clinical authority',
          sanitizeLogValue({ email, date, error })
        );
        throw new functions.https.HttpsError(
          'internal',
          'Failed to patch daily record with clinical authority.'
        );
      }
    }),
});

module.exports = {
  assertAuthorizedDailyRecordWriter,
  createDailyRecordWriteAuthorityFunctions,
};
