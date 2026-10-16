const functions = require('firebase-functions/v1');
const { applyPendingSpecialtyRules, isCurrentRapaNuiDay } = require('./specialtyRules');
const {
  assertTrustedSpecialtyAssignments,
  assertUnusedSpecialtyDecisionIds,
} = require('./specialtyAuditAuthority');

/** Prepare all reads before the policy transaction writes either document. */
const prepareSpecialtyPolicyApplication = async ({
  transaction,
  hospital,
  policy,
  date,
  actorUid,
  Timestamp,
}) => {
  if (date === undefined) return { status: 'not_requested', decisions: [] };
  if (!isCurrentRapaNuiDay(date)) {
    throw new functions.https.HttpsError(
      'failed-precondition',
      'Automatic specialties can only be applied to the current census.'
    );
  }
  if (!policy.autoEnabled) return { status: 'disabled', decisions: [] };
  const recordRef = hospital.collection('dailyRecords').doc(date);
  const snapshot = await transaction.get(recordRef);
  if (!snapshot.exists) return { status: 'record_missing', decisions: [] };
  const remote = snapshot.data();
  if (remote.date !== date) {
    throw new functions.https.HttpsError('failed-precondition', 'Invalid census date.');
  }
  await assertTrustedSpecialtyAssignments({
    transaction,
    hospitalRef: hospital,
    records: [remote],
  });
  const candidate = {
    ...remote,
    beds: Object.fromEntries(
      Object.entries(remote.beds || {}).map(([id, bed]) => [
        id,
        { ...bed, ...(bed.clinicalCrib ? { clinicalCrib: { ...bed.clinicalCrib } } : {}) },
      ])
    ),
  };
  // Empty or blocked beds must not receive a decision, including stale episode identifiers.
  for (const bed of Object.values(candidate.beds)) {
    for (const patient of [bed, bed.clinicalCrib]) {
      if (patient && (bed.isBlocked || !patient.patientName?.trim())) patient.isBlocked = true;
    }
  }
  const mutationId = `specialty-policy-${policy.revision}`;
  const decisions = applyPendingSpecialtyRules({
    remoteRecord: remote,
    candidate,
    policy,
    actorUid,
    mutationId,
    now: new Date().toISOString(),
  });
  await assertUnusedSpecialtyDecisionIds({ transaction, docRef: recordRef, decisions });
  if (!decisions.length) return { status: 'no_pending', decisions: [] };
  // Persist only the specialties, never the temporary eligibility markers above.
  const beds = { ...remote.beds };
  for (const decision of decisions) {
    const { bedId, target } = decision;
    const bed = { ...beds[bedId] };
    if (target === 'clinicalCrib')
      bed.clinicalCrib = {
        ...bed.clinicalCrib,
        specialty: decision.value,
        specialtyAssignment: decision.metadata,
      };
    else Object.assign(bed, { specialty: decision.value, specialtyAssignment: decision.metadata });
    beds[bedId] = bed;
  }
  const now = Timestamp.now();
  const revision = Number(remote.meta?.revision);
  const changedPaths = decisions.map(
    ({ bedId, target }) =>
      `beds.${bedId}.${target === 'clinicalCrib' ? 'clinicalCrib.' : ''}specialty`
  );
  return {
    status: 'applied',
    recordRef,
    decisions,
    record: {
      ...remote,
      beds,
      lastUpdated: now,
      meta: {
        ...remote.meta,
        revision: (Number.isFinite(revision) && revision >= 0 ? revision : 0) + 1,
        lastMutationId: mutationId,
        lastWriterClientId: null,
        lastWriterTabId: null,
        lastChangedPaths: changedPaths,
        updatedAt: now,
      },
    },
  };
};

/** Collapse equivalent codes; conflicting duplicate decisions require explicit review. */
const normalizePublishedSpecialtyRules = rules => {
  const { normalizeCode } = require('./specialtyRules');
  const byCode = new Map();
  for (const rule of rules) {
    if (!rule || typeof rule !== 'object') return rules;
    const code = normalizeCode(rule.cie10Code);
    const existing = byCode.get(code);
    if (
      existing &&
      (existing.kind !== rule.kind ||
        existing.specialty !== rule.specialty ||
        existing.scope !== rule.scope)
    ) {
      throw new functions.https.HttpsError(
        'invalid-argument',
        'Conflicting duplicate diagnosis rules require review.'
      );
    }
    if (!existing) byCode.set(code, { ...rule, cie10Code: code });
  }
  return [...byCode.values()];
};

module.exports = { prepareSpecialtyPolicyApplication, normalizePublishedSpecialtyRules };
