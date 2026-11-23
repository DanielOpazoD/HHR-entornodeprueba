// Who may write a daily record, which paths a patch may touch and what a write may never erase.
const { HttpsError } = require('firebase-functions/v2/https');
const { hospitalDayStart } = require('./hospitalCalendarDay');
const { requireAuthenticatedEmail } = require('./auth/authPolicies');
const { evaluateDailyRecordClinicalAuthority } = require('./dailyRecordClinicalAuthorityPolicy');
const {
  findPatientErasures,
  findPersistedEpisodeDowngrades,
} = require('./dailyRecordErasureGuard');
const {
  RAYEN_BATCH_ONLY_CLINICAL_FIELDS,
  isRayenClinicalWriteFenceActive,
} = require('./dailyRecordClinicalFieldPreservation');
const { FORBIDDEN_PATCH_PATH_SEGMENTS, isPlainObject } = require('./dailyRecordWriteRequest');

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

const specialtyEpisodeEnabled = () => process.env.HHR_SPECIALTY_EPISODE_ASSIGNMENT === 'enabled';

const parseAuthorizedPatchPath = (path, role, intentionalBedClear = null) => {
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

  throw new HttpsError(
    'invalid-argument',
    `Daily record patch path is not allowed: ${String(path).slice(0, 120)}`
  );
};

const assertAuthorizedPatchValue = ({ path, value, parsedPath, patchPaths }) => {
  if (parsedPath.kind !== 'bedTypeOverride') {
    return;
  }

  if (!ALLOWED_DAILY_RECORD_BED_TYPE_OVERRIDE_VALUES.has(value)) {
    throw new HttpsError(
      'invalid-argument',
      `Daily record bed type override value is not allowed: ${String(path).slice(0, 120)}`
    );
  }

  if (
    !patchPaths.has(`beds.${parsedPath.bedId}.upcChecklist`) &&
    !patchPaths.has(`beds.${parsedPath.bedId}.isUPC`)
  ) {
    throw new HttpsError(
      'invalid-argument',
      `Daily record bed type override must accompany a UPC patch: ${String(path).slice(0, 120)}`
    );
  }
};

const inspectAuthorizedPatch = ({ remoteData, patch, role, intentionalBedClear = null }) => {
  const patchPaths = new Set(Object.keys(patch));
  let requiresStructuralAuthority = false;
  Object.entries(patch).forEach(([path, value]) => {
    const parsedPath = parseAuthorizedPatchPath(path, role, intentionalBedClear);
    if (parsedPath.kind === 'structuralField') {
      const patient = remoteData?.beds?.[parsedPath.bedId];
      if (!isPlainObject(patient)) {
        throw new HttpsError(
          'failed-precondition',
          `Daily record patch target bed is not present: ${parsedPath.bedId}`
        );
      }
      if (patient.isBlocked === true) {
        throw new HttpsError(
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
      throw new HttpsError(
        'failed-precondition',
        `Daily record patch target bed is not present: ${bedId}`
      );
    }
    if (patient.isBlocked === true) {
      throw new HttpsError(
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
      throw new HttpsError(
        'failed-precondition',
        `Daily record patch target bed has no active clinical episode identity: ${bedId}`
      );
    }
  });
  return { requiresStructuralAuthority };
};

// Solo los campos EXCLUSIVOS del lote (mediciones y checkpoint) quedan
// vallados para parches directos: los dispositivos (devices/deviceDetails/
// deviceInstanceHistory) son datos operacionales que enfermería gestiona a
// mano entre corridas — vallarlos dejaba «agregar LA/SNG» guardando solo en
// local y perdiéndose al recargar (verificado en vivo 31-08).
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
  throw new HttpsError(
    'failed-precondition',
    'Rayen clinical fields must be written through the authoritative clinical batch.'
  );
};

// From 24 hours before to 48 hours after the day's hospital midnight (TIME-02), as the Firestore
// rules allow. The Admin SDK skips those rules, so the day's date sets that midnight: never a
// dateTimestamp, which the client sends and a full save stores as sent.
const isWithinNurseEditingWindow = date => {
  const dayStart = hospitalDayStart(date);
  const now = Date.now();
  return now > dayStart - 86_400_000 && now < dayStart + 172_800_000;
};

// Every nurse patch keeps to the window, clinical fields included, as the rules require of any
// direct nurse update. The administrator has no window.
const assertNursePatchWindow = ({ date, role }) => {
  if (role !== 'nurse_hospital' || isWithinNurseEditingWindow(date)) return;
  throw new HttpsError(
    'permission-denied',
    'The nurse editing window for this daily record has closed.'
  );
};

const assertStructuralPatchPolicy = ({ policySnapshot }) => {
  if (!isRayenClinicalWriteFenceActive(policySnapshot)) {
    throw new HttpsError(
      'failed-precondition',
      'Structural daily record patches require the schema-v2 server clinical authority fence.'
    );
  }
};

const assertFullRecordWritePolicy = ({ date, snapshot, record, role }) => {
  if (!snapshot.exists) {
    if (role === 'admin' || role === 'nurse_hospital') return;
    throw new HttpsError(
      'permission-denied',
      'Only administrators and hospital nurses can create daily records.'
    );
  }

  if (role === 'admin') return;
  if (
    role === 'nurse_hospital' &&
    Number.isFinite(Number(record?.dateTimestamp)) &&
    isWithinNurseEditingWindow(date)
  ) {
    return;
  }

  throw new HttpsError(
    'permission-denied',
    role === 'nurse_hospital'
      ? 'The nurse editing window for this daily record has closed.'
      : 'This role must use its scoped daily-record write operation.'
  );
};

const assertClinicalAuthority = record => {
  const result = evaluateDailyRecordClinicalAuthority(record);
  return result;
};

const assertAuthorizedDailyRecordWriter = async ({
  context,
  resolveRoleForEmail,
  requiredRole = undefined,
}) => {
  const email = requireAuthenticatedEmail(context);
  const resolvedRole = await resolveRoleForEmail(email, context);

  if (requiredRole && resolvedRole !== requiredRole) {
    throw new HttpsError(
      'permission-denied',
      'This daily-record operation requires an administrator.'
    );
  }
  if (!ALLOWED_DAILY_RECORD_WRITE_ROLES.has(resolvedRole)) {
    throw new HttpsError(
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
  throw new HttpsError(
    'failed-precondition',
    `La cama ${detail} tiene un paciente en la nube pero está vacía en la copia entrante. ` +
      'El guardado fue bloqueado para evitar pérdida de datos.'
  );
};

const assertNoPersistedEpisodeDowngrades = ({ snapshot, record }) => {
  if (!snapshot.exists) return;
  const downgrades = findPersistedEpisodeDowngrades(snapshot.data() || {}, record);
  if (!downgrades.length) return;
  const detail = downgrades.map(item => item.bedId).join(', ');
  throw new HttpsError(
    'failed-precondition',
    `El guardado se bloqueó porque esta copia perdió la referencia del episodio en ${detail}. ` +
      'Recarga el censo y revisa el paciente y su ingreso antes de volver a guardar.'
  );
};

module.exports = {
  STRUCTURAL_DAILY_RECORD_PATCH_ROLES,
  assertAuthorizedDailyRecordWriter,
  assertClinicalAuthority,
  assertFullRecordWritePolicy,
  assertNoPatientErasures,
  assertNoPersistedEpisodeDowngrades,
  assertNoRayenClinicalOwnedPatch,
  assertNursePatchWindow,
  assertStructuralPatchPolicy,
  inspectAuthorizedPatch,
  specialtyEpisodeEnabled,
};
