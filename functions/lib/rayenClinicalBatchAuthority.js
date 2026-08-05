const functions = require('firebase-functions/v1');

const POLICY_SCHEMA_VERSION = 2;
const LEGACY_POLICY_SCHEMA_VERSION = 1;
const CLINICAL_BATCH_MODES = new Set(['shadow', 'enforced']);
const IMPORT_MODES = new Set(['preview', 'auto']);

const failPolicyAuthority = () => {
  throw new functions.https.HttpsError(
    'failed-precondition',
    'Clinical enrichment is not authorized by the current global policy.'
  );
};

const parseGlobalPolicy = snapshot => {
  if (!snapshot?.exists) failPolicyAuthority();
  const policy = snapshot.data?.() || {};
  if (
    policy.schemaVersion !== POLICY_SCHEMA_VERSION ||
    !IMPORT_MODES.has(policy.mode) ||
    !CLINICAL_BATCH_MODES.has(policy.clinicalBatchMode) ||
    !Number.isInteger(policy.revision) ||
    policy.revision < 1
  ) {
    failPolicyAuthority();
  }
  return policy;
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

const parseLegacyGlobalPolicy = snapshot => {
  if (!snapshot?.exists) {
    return { mode: 'preview', revision: 0 };
  }
  const policy = snapshot.data?.() || {};
  if (
    policy.schemaVersion !== LEGACY_POLICY_SCHEMA_VERSION ||
    !IMPORT_MODES.has(policy.mode) ||
    !Number.isInteger(policy.revision) ||
    policy.revision < 1
  ) {
    failPolicyAuthority();
  }
  return policy;
};

const assertLegacyRayenClinicalBatchAuthority = ({ policySnapshot, record, payload }) => {
  if (
    payload.date !== payload.authorityDate ||
    payload.date !== currentRapaNuiCalendarDay() ||
    record?.date !== payload.date
  ) {
    failPolicyAuthority();
  }

  const globalPolicy = parseLegacyGlobalPolicy(policySnapshot);
  const matchingStructuralRun = Array.isArray(record?.rayenSyncHistory)
    ? record.rayenSyncHistory.find(
        event =>
          event?.status === 'applied' &&
          event?.policy?.mode === globalPolicy.mode &&
          event?.policy?.revision === globalPolicy.revision &&
          event?.policy?.clinicalBatchMode === undefined
      )
    : null;
  if (!matchingStructuralRun) failPolicyAuthority();

  return { policyRevision: globalPolicy.revision, sourceDate: payload.date };
};

const assertRayenClinicalRunAuthority = ({ record, payload }) => {
  const runEvent = Array.isArray(record?.rayenSyncHistory)
    ? record.rayenSyncHistory.find(event => event?.id === payload.runId)
    : null;
  const legacySameDayAuthority =
    payload.legacyAuthorityInference === true &&
    payload.date === payload.authorityDate &&
    runEvent?.sourceDate === undefined;
  if (
    !runEvent ||
    record?.date !== payload.authorityDate ||
    (!legacySameDayAuthority && runEvent?.sourceDate !== payload.authorityDate)
  ) {
    failPolicyAuthority();
  }
  return { runEvent, sourceDate: runEvent.sourceDate ?? payload.authorityDate };
};

/**
 * Binds a callable request to the server-confirmed policy frozen by its census run.
 * A policy change during a run deliberately invalidates the old request so a new run
 * can retry under one coherent authority decision.
 */
const assertRayenClinicalBatchAuthority = ({ policySnapshot, record, payload }) => {
  if (payload.legacyAuthorityInference === true) {
    return assertLegacyRayenClinicalBatchAuthority({ policySnapshot, record, payload });
  }
  const globalPolicy = parseGlobalPolicy(policySnapshot);
  const { runEvent, sourceDate } = assertRayenClinicalRunAuthority({ record, payload });
  const runPolicy = runEvent?.policy;

  if (
    globalPolicy.clinicalBatchMode !== payload.mode ||
    runEvent.status !== 'applied' ||
    !runPolicy ||
    runPolicy.mode !== globalPolicy.mode ||
    runPolicy.clinicalBatchMode !== globalPolicy.clinicalBatchMode ||
    runPolicy.revision !== globalPolicy.revision
  ) {
    failPolicyAuthority();
  }

  return { policyRevision: globalPolicy.revision, sourceDate };
};

module.exports = {
  assertRayenClinicalBatchAuthority,
  assertRayenClinicalRunAuthority,
};
