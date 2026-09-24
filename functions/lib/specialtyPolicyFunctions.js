const functions = require('firebase-functions/v1');
const crypto = require('node:crypto');
const { HOSPITAL_ID } = require('./runtime/runtimeConfig');
const { assertAuthorizedDailyRecordWriter } = require('./dailyRecordWriteAuthorityFunctions');
const { SPECIALTIES, getPatient } = require('./specialtyDecisionContract');
const { normalizeCode, validCode, validatePolicy, isCurrentRapaNuiDay } = require('./specialtyRules');
const { assertTrustedSpecialtyPatient } = require('./specialtyAuditAuthority');

const fail = (code, message) => { throw new functions.https.HttpsError(code, message); };
const assertPilotEnabled = () => {
  if (process.env.HHR_SPECIALTY_EPISODE_ASSIGNMENT !== 'enabled') {
    fail('failed-precondition', 'Specialty episode mode is disabled.');
  }
};
const readPolicy = snapshot => snapshot.exists ? snapshot.data() : {
  schemaVersion: 1, revision: 0, autoEnabled: false, memoryEnabled: false,
  aiMode: 'off', rules: [], memory: [],
};
const assertAdmin = async (context, resolveRoleForEmail) => {
  const { role } = await assertAuthorizedDailyRecordWriter({ context, resolveRoleForEmail });
  if (role !== 'admin') fail('permission-denied', 'Only administrators may publish specialty rules.');
};
const assertExpectedRevision = (current, expectedRevision) => {
  if (!Number.isInteger(expectedRevision) || expectedRevision !== current.revision) {
    fail('aborted', 'Specialty catalog changed; reload before publishing.');
  }
};
const assertPolicy = policy => {
  if (!validatePolicy(policy) || JSON.stringify(policy).length > 256 * 1024) {
    fail('invalid-argument', 'Invalid specialty catalog.');
  }
};

const createSpecialtyPolicyFunctions = ({ firestore, resolveRoleForEmail }) => ({
  publishSpecialtyMemory: functions.region('southamerica-east1').https.onCall(async (data, context) => {
    await assertAdmin(context, resolveRoleForEmail);
    assertPilotEnabled();
    if (data?.confirmed !== true || !isCurrentRapaNuiDay(data?.date) ||
        !['bed', 'clinicalCrib'].includes(data?.target) ||
        typeof data?.bedId !== 'string' || !/^[A-Za-z0-9_-]{1,40}$/.test(data.bedId) ||
        typeof data?.episodeId !== 'string' || !data.episodeId.trim() ||
        !SPECIALTIES.has(data?.specialty) || ['', 'Otro'].includes(data.specialty)) {
      fail('invalid-argument', 'Explicit current-episode memory confirmation is required.');
    }
    const hospital = firestore.collection('hospitals').doc(HOSPITAL_ID);
    const policyRef = hospital.collection('specialtyPolicies').doc('active');
    const authorityPolicyRef = hospital.collection('settings').doc('rayenImportPolicy');
    const recordRef = hospital.collection('dailyRecords').doc(data.date);
    return firestore.runTransaction(async transaction => {
      const [policySnapshot, recordSnapshot, authorityPolicySnapshot] = await Promise.all([
        transaction.get(policyRef), transaction.get(recordRef), transaction.get(authorityPolicyRef),
      ]);
      if (!authorityPolicySnapshot.exists || authorityPolicySnapshot.data()?.schemaVersion !== 2) {
        fail('failed-precondition', 'Server clinical authority is required first.');
      }
      if (!recordSnapshot.exists) fail('failed-precondition', 'Daily record is unavailable.');
      const patient = getPatient(recordSnapshot.data(), data.bedId, data.target);
      if (patient?.clinicalEpisodeId !== data.episodeId ||
          patient?.specialty !== data.specialty ||
          patient?.specialtyAssignment?.decisionId !== data.expectedDecisionId ||
          !['manual', 'manual_ai'].includes(patient?.specialtyAssignment?.source)) {
        fail('aborted', 'Specialty decision or episode changed.');
      }
      await assertTrustedSpecialtyPatient({ transaction, hospitalRef: hospital, patient });
      const code = normalizeCode(patient.cie10Code);
      if (!validCode(code) || code !== data.expectedCie10Code) {
        fail('aborted', 'Diagnosis changed; reload before publishing memory.');
      }
      const policy = readPolicy(policySnapshot);
      if (policy.revision > 0) assertPolicy(policy);
      assertExpectedRevision(policy, data.expectedRevision);
      const id = `memory_${crypto.createHash('sha256').update(`${code}|all`).digest('hex').slice(0, 20)}`;
      const existing = policy.memory.find(rule => rule.id === id);
      if (existing) {
        if (existing.specialty !== data.specialty) fail('already-exists', 'Conflicting memory requires review.');
        return { status: 'already_published', revision: policy.revision, code, scope: 'all' };
      }
      const next = { ...policy, revision: policy.revision + 1,
        memory: [...policy.memory, { id, kind: 'assign', cie10Code: code,
          specialty: data.specialty, scope: 'all', revision: 1 }],
        updatedByUid: context.auth.uid, updatedAt: new Date().toISOString() };
      assertPolicy(next);
      transaction.set(policyRef, next);
      return { status: 'published', revision: next.revision, code, scope: 'all' };
    });
  }),
  configureSpecialtyPolicy: functions.region('southamerica-east1').https.onCall(async (data, context) => {
    await assertAdmin(context, resolveRoleForEmail);
    assertPilotEnabled();
    if (data?.confirmed !== true || typeof data.autoEnabled !== 'boolean' ||
        typeof data.memoryEnabled !== 'boolean' || !['off', 'consultative'].includes(data.aiMode)) {
      fail('invalid-argument', 'Explicit specialty policy confirmation is required.');
    }
    if ((data.rules !== undefined && !Array.isArray(data.rules)) ||
        (data.memory !== undefined && !Array.isArray(data.memory))) {
      fail('invalid-argument', 'Rules and memory must be complete replacement lists.');
    }
    const hospital = firestore.collection('hospitals').doc(HOSPITAL_ID);
    const policyRef = hospital.collection('specialtyPolicies').doc('active');
    const authorityPolicyRef = hospital.collection('settings').doc('rayenImportPolicy');
    return firestore.runTransaction(async transaction => {
      const [snapshot, authorityPolicySnapshot] = await Promise.all([
        transaction.get(policyRef), transaction.get(authorityPolicyRef),
      ]);
      if (!authorityPolicySnapshot.exists || authorityPolicySnapshot.data()?.schemaVersion !== 2) {
        fail('failed-precondition', 'Server clinical authority is required first.');
      }
      const current = readPolicy(snapshot);
      if (current.revision > 0) assertPolicy(current);
      assertExpectedRevision(current, data.expectedRevision);
      const next = { ...current, revision: current.revision + 1,
        autoEnabled: data.autoEnabled, memoryEnabled: data.memoryEnabled,
        aiMode: data.aiMode, updatedByUid: context.auth.uid,
        ...(data.rules !== undefined ? { rules: data.rules } : {}),
        ...(data.memory !== undefined ? { memory: data.memory } : {}),
        ...(data.aiRubrics ? { aiRubrics: data.aiRubrics } : {}),
        ...(data.diagnosisLabels ? { diagnosisLabels: data.diagnosisLabels } : {}),
        ...(Number.isInteger(data.aiMonthlyLimit) ? { aiMonthlyLimit: data.aiMonthlyLimit } : {}),
        updatedAt: new Date().toISOString() };
      assertPolicy(next);
      transaction.set(policyRef, next);
      return { revision: next.revision, autoEnabled: next.autoEnabled,
        memoryEnabled: next.memoryEnabled, aiMode: next.aiMode,
        ruleCount: next.rules.length, memoryCount: next.memory.length };
    });
  }),
});

module.exports = { createSpecialtyPolicyFunctions };
