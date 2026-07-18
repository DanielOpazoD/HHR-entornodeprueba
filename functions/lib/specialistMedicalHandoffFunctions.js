const functions = require('firebase-functions/v1');
const { HOSPITAL_ID } = require('./runtime/runtimeConfig');
const { requireAuthenticatedEmail } = require('./auth/authPolicies');
const { sanitizeLogValue } = require('./logging/redaction');

/**
 * Productive write path for specialist medical handoff notes.
 *
 * Why this exists:
 * - direct Firestore writes for `doctor_specialist` proved fragile under the restrictive
 *   rules branch even when the visible payload was correct;
 * - this callable keeps the mutation server-side, with a single role resolution source
 *   (`config/roles`) and a narrow whitelist.
 *
 * Important invariants:
 * - exactly one bed per request;
 * - only medical handoff fields are accepted;
 * - existing beds only; this callable must not create structural beds;
 * - `lastUpdated` is owned by the server;
 * - the client may still use optimistic cache updates, so this callable must stay focused
 *   and deterministic.
 */
const ALLOWED_SPECIALIST_BED_IDS = new Set([
  'R1',
  'R2',
  'R3',
  'R4',
  'NEO1',
  'NEO2',
  'H1C1',
  'H1C2',
  'H2C1',
  'H2C2',
  'H3C1',
  'H3C2',
  'H4C1',
  'H4C2',
  'H5C1',
  'H5C2',
  'H6C1',
  'H6C2',
  'E1',
  'E2',
  'E3',
  'E4',
  'E5',
]);

const ALLOWED_SPECIALIST_BED_PATH_PREFIXES = [
  'medicalHandoffEntries',
  'medicalHandoffNote',
  'medicalHandoffAudit',
  'clinicalEvents',
  'clinicalCrib.medicalHandoffEntries',
  'clinicalCrib.medicalHandoffNote',
  'clinicalCrib.medicalHandoffAudit',
  'clinicalCrib.clinicalEvents',
];

const isPlainObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);

const assertStringField = (value, fieldName) => {
  if (typeof value !== 'string' || !value.trim()) {
    throw new functions.https.HttpsError(
      'invalid-argument',
      `Missing required field: ${fieldName}`
    );
  }

  return value.trim();
};

const isAllowedSpecialistPath = nestedPath =>
  ALLOWED_SPECIALIST_BED_PATH_PREFIXES.some(
    prefix => nestedPath === prefix || nestedPath.startsWith(`${prefix}.`)
  );

const parseSpecialistPatch = rawPatch => {
  if (!isPlainObject(rawPatch)) {
    throw new functions.https.HttpsError(
      'invalid-argument',
      'Specialist medical handoff patch must be an object.'
    );
  }

  const sanitizedPatch = {};
  const touchedBedIds = new Set();

  for (const [path, value] of Object.entries(rawPatch)) {
    if (path === 'lastUpdated') {
      continue;
    }

    if (path === 'dateTimestamp') {
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new functions.https.HttpsError(
          'invalid-argument',
          'dateTimestamp must be a finite number.'
        );
      }
      sanitizedPatch[path] = Math.trunc(value);
      continue;
    }

    if (!path.startsWith('beds.')) {
      throw new functions.https.HttpsError(
        'invalid-argument',
        `Unsupported specialist medical handoff path: ${path}`
      );
    }

    const pathSegments = path.split('.');
    const bedId = pathSegments[1];
    const nestedPath = pathSegments.slice(2).join('.');

    if (!bedId || !nestedPath) {
      throw new functions.https.HttpsError(
        'invalid-argument',
        `Invalid specialist medical handoff path: ${path}`
      );
    }

    if (!ALLOWED_SPECIALIST_BED_IDS.has(bedId)) {
      throw new functions.https.HttpsError(
        'permission-denied',
        'Bed is not enabled for specialist medical handoff writes.'
      );
    }

    if (!isAllowedSpecialistPath(nestedPath)) {
      throw new functions.https.HttpsError(
        'permission-denied',
        `Field is not allowed for specialist medical handoff writes: ${path}`
      );
    }

    touchedBedIds.add(bedId);
    sanitizedPatch[path] = value;
  }

  if (touchedBedIds.size !== 1) {
    throw new functions.https.HttpsError(
      'invalid-argument',
      'Specialist medical handoff writes must target exactly one bed.'
    );
  }

  if (Object.keys(sanitizedPatch).length === 0) {
    throw new functions.https.HttpsError(
      'invalid-argument',
      'Specialist medical handoff patch is empty.'
    );
  }

  return {
    bedId: Array.from(touchedBedIds)[0],
    patch: sanitizedPatch,
  };
};

const createSpecialistMedicalHandoffFunctions = ({ firestore, Timestamp, resolveRoleForEmail }) => ({
  updateSpecialistMedicalHandoff: functions.https.onCall(async (data, context) => {
    const email = requireAuthenticatedEmail(context);
    const resolvedRole = await resolveRoleForEmail(email);

    if (resolvedRole !== 'doctor_specialist' && resolvedRole !== 'admin') {
      throw new functions.https.HttpsError(
        'permission-denied',
        'Only authorized specialists can update medical handoff notes.'
      );
    }

    const date = assertStringField(data?.date, 'date');
    const { bedId, patch } = parseSpecialistPatch(data?.patch);

    const docRef = firestore
      .collection('hospitals')
      .doc(HOSPITAL_ID)
      .collection('dailyRecords')
      .doc(date);

    const snapshot = await docRef.get();
    if (!snapshot.exists) {
      throw new functions.https.HttpsError('not-found', 'Daily record not found.');
    }

    const existingBed = snapshot.data()?.beds?.[bedId];
    if (!existingBed || typeof existingBed !== 'object') {
      throw new functions.https.HttpsError(
        'failed-precondition',
        'Daily record bed is missing or invalid for specialist medical handoff.'
      );
    }

    try {
      await docRef.update({
        ...patch,
        lastUpdated: Timestamp.now(),
      });

      return {
        success: true,
        date,
        bedId,
      };
    } catch (error) {
      console.error(
        'Error updating specialist medical handoff',
        sanitizeLogValue({ email, date, bedId, error })
      );
      throw new functions.https.HttpsError(
        'internal',
        'Failed to update specialist medical handoff.'
      );
    }
  }),
});

module.exports = {
  createSpecialistMedicalHandoffFunctions,
};
