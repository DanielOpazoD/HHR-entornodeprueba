const { isDeepStrictEqual } = require('node:util');
const { SpecialtyDecisionError, validExistingMeta, getPatient } =
  require('./specialtyDecisionContract');

const targets = record => {
  const entries = [];
  for (const bedId of Object.keys(record?.beds || {})) {
    for (const target of ['bed', 'clinicalCrib']) {
      const patient = getPatient(record, bedId, target);
      if (patient?.specialtyAssignment != null) entries.push(patient);
    }
  }
  return entries;
};

const auditRefFor = (hospitalRef, meta) => hospitalRef.collection('dailyRecords')
  .doc(meta.recordDate).collection('specialtyDecisions').doc(meta.decisionId);

// Direct clients cannot create audit documents. This verifies that provenance
// seen before catalog activation was actually produced by the server.
const assertTrustedSpecialtyPatient = async ({ transaction, hospitalRef, patient }) => {
  const meta = patient?.specialtyAssignment;
  if (!validExistingMeta(meta, patient)) {
    throw new SpecialtyDecisionError('failed-precondition', 'Unverified specialty provenance.');
  }
  const snapshot = await transaction.get(auditRefFor(hospitalRef, meta));
  const audit = snapshot.exists ? snapshot.data() : null;
  if (!audit || audit.recordDate !== meta.recordDate ||
        audit.decisionId !== meta.decisionId || audit.episodeId !== meta.episodeId ||
        audit.value !== patient.specialty || !isDeepStrictEqual(audit.metadata, meta)) {
    throw new SpecialtyDecisionError('failed-precondition', 'Unverified specialty provenance.');
  }
};

const assertTrustedSpecialtyAssignments = async ({ transaction, hospitalRef, records }) =>
  Promise.all(records.flatMap(targets).map(patient =>
    assertTrustedSpecialtyPatient({ transaction, hospitalRef, patient })));

const assertUnusedSpecialtyDecisionIds = async ({ transaction, docRef, decisions }) => {
  const snapshots = await Promise.all(decisions.map(decision =>
    transaction.get(docRef.collection('specialtyDecisions').doc(decision.decisionId))));
  if (snapshots.some(snapshot => snapshot.exists)) {
    throw new SpecialtyDecisionError('aborted', 'Specialty decision ID was already used.');
  }
};

module.exports = { assertTrustedSpecialtyPatient, assertTrustedSpecialtyAssignments,
  assertUnusedSpecialtyDecisionIds };
