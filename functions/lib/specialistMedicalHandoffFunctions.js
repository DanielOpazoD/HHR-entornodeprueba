const functions = require('firebase-functions/v1');
const { HOSPITAL_ID } = require('./runtime/runtimeConfig');
const { requireAuthenticatedEmail } = require('./auth/authPolicies');
const { sanitizeLogValue } = require('./logging/redaction');
const {
  calendarStampInClinicalTimeZone,
  resolveClinicalDayForDateTime,
} = require('./generated/cudyrSourceParser.cjs');

// Same FNV-1a legacy identity policy as clinicalEpisodeIdPolicy.ts; never includes a bed.
const resolveHandoffEpisodeId = patient => {
  const existing = String(patient?.clinicalEpisodeId || '').trim();
  if (existing) return existing;
  const identity = patient?.rut || patient?.patientName || 'sin-rut';
  const admission = patient?.firstSeenDate || patient?.admissionDate || 'sin-ingreso';
  const time = String(patient?.admissionTime || '').trim();
  const key = `${identity}__${admission}${time ? `__${time}` : ''}`;
  if (key === 'sin-rut__sin-ingreso') return undefined;
  let hash = 0x811c9dc5;
  const normalized = key.toLowerCase();
  for (let i = 0; i < normalized.length; i += 1) {
    hash ^= normalized.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return `legacy_ep_${(hash >>> 0).toString(36)}`;
};

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

// Same state as specialistHandoffTextState on the client: the note and each entry's id and text.
const handoffTextState = patient =>
  JSON.stringify([
    String(patient?.medicalHandoffNote ?? ''),
    (Array.isArray(patient?.medicalHandoffEntries) ? patient.medicalHandoffEntries : []).map(
      entry => [String(entry?.id ?? ''), String(entry?.note ?? '')]
    ),
  ]);

const patchedHandoffTextState = (patient, patch, path) => {
  const pick = field =>
    Object.prototype.hasOwnProperty.call(patch, `${path}.${field}`)
      ? patch[`${path}.${field}`]
      : patient?.[field];
  return handoffTextState({
    medicalHandoffNote: pick('medicalHandoffNote'),
    medicalHandoffEntries: pick('medicalHandoffEntries'),
  });
};

const MAX_HANDOFF_BASES = 8;
const MAX_HANDOFF_BASE_LENGTH = 200000;
const isValidHandoffBases = bases =>
  bases === undefined ||
  (Array.isArray(bases) &&
    bases.length > 0 &&
    bases.length <= MAX_HANDOFF_BASES &&
    bases.every(base => typeof base === 'string' && base.length <= MAX_HANDOFF_BASE_LENGTH));

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

const assertRecordDate = date => {
  const parsed = Date.parse(`${date}T00:00:00.000Z`);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    !Number.isFinite(parsed) ||
    new Date(parsed).toISOString().slice(0, 10) !== date
  ) {
    throw new functions.https.HttpsError(
      'invalid-argument',
      'Invalid medical handoff record date.'
    );
  }
};

const assertSpecialistClinicalDay = (date, role) => {
  if (role !== 'doctor_specialist') return;
  const { iso, hhmm } = calendarStampInClinicalTimeZone();
  if (date !== resolveClinicalDayForDateTime(iso, hhmm)) {
    throw new functions.https.HttpsError(
      'permission-denied',
      'Specialists can only update the current clinical day.'
    );
  }
};

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

const createSpecialistMedicalHandoffFunctions = ({
  firestore,
  Timestamp,
  resolveRoleForEmail,
}) => ({
  updateSpecialistMedicalHandoff: functions.https.onCall(async (data, context) => {
    const email = requireAuthenticatedEmail(context);
    const resolvedRole = await resolveRoleForEmail(email, context);

    if (resolvedRole !== 'doctor_specialist' && resolvedRole !== 'admin') {
      throw new functions.https.HttpsError(
        'permission-denied',
        'Only authorized specialists can update medical handoff notes.'
      );
    }

    const date = assertStringField(data?.date, 'date');
    assertRecordDate(date);
    assertSpecialistClinicalDay(date, resolvedRole);
    const { bedId, patch } = parseSpecialistPatch(data?.patch);

    const docRef = firestore
      .collection('hospitals')
      .doc(HOSPITAL_ID)
      .collection('dailyRecords')
      .doc(date);

    const targetNames = new Set(
      Object.keys(patch)
        .filter(path => path.startsWith('beds.'))
        .map(path => (path.split('.')[2] === 'clinicalCrib' ? 'clinicalCrib' : 'bed'))
    );
    const legacyClient = !Object.prototype.hasOwnProperty.call(data, 'expectedOccupants');
    const expectedOccupants = legacyClient ? [] : data.expectedOccupants;
    const mutationId = data?.mutationId;
    if (
      mutationId !== undefined &&
      (typeof mutationId !== 'string' || !mutationId.trim() || mutationId.length > 200)
    ) {
      throw new functions.https.HttpsError('invalid-argument', 'Invalid medical handoff write id.');
    }
    if (
      !legacyClient &&
      (!Array.isArray(expectedOccupants) ||
        expectedOccupants.length !== targetNames.size ||
        [...targetNames].some(
          target =>
            expectedOccupants.filter(
              expected =>
                isPlainObject(expected) &&
                expected.bedId === bedId &&
                expected.target === target &&
                typeof expected.clinicalEpisodeId === 'string' &&
                expected.clinicalEpisodeId.trim() &&
                typeof expected.rut === 'string' &&
                typeof expected.patientName === 'string' &&
                expected.patientName.trim() &&
                ['RUT', 'Pasaporte'].includes(expected.documentType) &&
                isValidHandoffBases(expected.handoffBases)
            ).length !== 1
        ))
    ) {
      throw new functions.https.HttpsError(
        'failed-precondition',
        `Falta la identidad del paciente o episodio de la cama ${bedId}. Recarga la página antes de guardar la entrega médica.`
      );
    }

    try {
      return await firestore.runTransaction(async transaction => {
        const snapshot = await transaction.get(docRef);
        if (!snapshot.exists) {
          throw new functions.https.HttpsError('not-found', 'Daily record not found.');
        }

        const record = snapshot.data();
        if (record?.date != null && record.date !== date) {
          throw new functions.https.HttpsError(
            'failed-precondition',
            'Daily record date mismatch.'
          );
        }
        if (
          patch.dateTimestamp !== undefined &&
          record?.dateTimestamp != null &&
          patch.dateTimestamp !== record.dateTimestamp
        ) {
          throw new functions.https.HttpsError(
            'permission-denied',
            'Record timestamp is immutable.'
          );
        }
        // A replay of the write this record last took (its answer was lost) changes nothing.
        if (mutationId && record?.meta?.lastMutationId === mutationId) {
          return { success: true, date, bedId, alreadyApplied: true };
        }

        // Transitional compatibility for pre-deploy tabs: retain the former allowlisted
        // behavior, now atomically. Remove only after legacy traffic reaches zero.
        if (legacyClient) {
          console.warn('specialist_handoff_legacy_client', sanitizeLogValue({ date, bedId }));
          if (!isPlainObject(record?.beds?.[bedId])) {
            throw new functions.https.HttpsError(
              'failed-precondition',
              'Daily record bed is missing or invalid.'
            );
          }
        }
        for (const expected of expectedOccupants) {
          const bed = record?.beds?.[bedId];
          const patient = expected.target === 'clinicalCrib' ? bed?.clinicalCrib : bed;
          if (
            !isPlainObject(patient) ||
            !patient.patientName?.trim() ||
            resolveHandoffEpisodeId(patient) !== expected.clinicalEpisodeId.trim() ||
            (patient.rut?.trim() || '') !== expected.rut.trim() ||
            (patient.documentType || 'RUT') !== expected.documentType ||
            patient.patientName.trim() !== expected.patientName.trim()
          ) {
            throw new functions.https.HttpsError(
              'failed-precondition',
              `El paciente o episodio de la cama ${bedId}${expected.target === 'clinicalCrib' ? ' (cuna)' : ''} cambió. Recarga antes de guardar la entrega médica.`
            );
          }
          // Never write over a note someone else saved after this edit started.
          const path = `beds.${bedId}${expected.target === 'clinicalCrib' ? '.clinicalCrib' : ''}`;
          const stored = handoffTextState(patient);
          if (
            expected.handoffBases &&
            stored !== patchedHandoffTextState(patient, patch, path) &&
            !expected.handoffBases.includes(stored)
          ) {
            throw new functions.https.HttpsError(
              'failed-precondition',
              `La nota de la cama ${bedId}${expected.target === 'clinicalCrib' ? ' (cuna)' : ''} cambió después de que se escribió este texto. Revisa el borrador antes de guardarlo.`
            );
          }
        }

        assertSpecialistClinicalDay(date, resolvedRole);
        const writes = Object.fromEntries(
          Object.entries(patch).filter(([path]) => path !== 'dateTimestamp')
        );
        transaction.update(docRef, {
          ...writes,
          lastUpdated: Timestamp.now(),
          // Like the other server writers, so a replay or a stale queued edit can recognize it.
          ...(mutationId
            ? { 'meta.lastMutationId': mutationId, 'meta.lastChangedPaths': Object.keys(writes) }
            : {}),
        });

        return {
          success: true,
          date,
          bedId,
        };
      });
    } catch (error) {
      if (error instanceof functions.https.HttpsError) throw error;
      console.error(
        'Error updating specialist medical handoff',
        sanitizeLogValue({ email, date, bedId, code: error?.code })
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
