const functions = require('firebase-functions/v1');
const { HOSPITAL_ID } = require('./runtime/runtimeConfig');
const { assertAuthorizedDailyRecordWriter } = require('./dailyRecordWriteAuthorityFunctions');
const { getPatient } = require('./specialtyDecisionContract');
const { validatePolicy, resolvePendingSpecialty, isCurrentRapaNuiDay } = require('./specialtyRules');
const { buildJevEvidence } = require('./specialtyJevEvidence');
const { evaluateWithJev, JevAdapterError } = require('./specialtyJevAdapter');

const fail = (code, message) => { throw new functions.https.HttpsError(code, message); };
const validRequestId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{12,100}$/.test(value);
const validBedId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(value);
const clinicalApproved = () => process.env.HHR_JEV_CLINICAL_APPROVED === 'enabled' &&
  process.env.HHR_SPECIALTY_EPISODE_ASSIGNMENT === 'enabled' &&
  Boolean(process.env.TYPESAFE_API_KEY);

const createSpecialtyJevFunctions = ({ firestore, resolveRoleForEmail }) => ({
  requestSpecialtyJevSuggestion: functions.region('southamerica-east1')
    .runWith({ timeoutSeconds: 30, memory: '512MB', secrets: ['TYPESAFE_API_KEY'] })
    .https.onCall(async (data, context) => {
      await assertAuthorizedDailyRecordWriter({ context, resolveRoleForEmail });
      if (data?.action === 'read_policy') {
        if (process.env.HHR_SPECIALTY_EPISODE_ASSIGNMENT !== 'enabled') {
          fail('failed-precondition', 'Specialty episode mode is disabled.');
        }
        const snapshot = await firestore.collection('hospitals').doc(HOSPITAL_ID)
          .collection('specialtyPolicies').doc('active').get();
        const policy = snapshot.exists ? snapshot.data() : {
          revision: 0, autoEnabled: false, memoryEnabled: false, aiMode: 'off', rules: [],
        };
        if (policy.revision > 0 && !validatePolicy(policy)) {
          fail('failed-precondition', 'Specialty catalog is invalid.');
        }
        return { revision: policy.revision, autoEnabled: policy.autoEnabled,
          memoryEnabled: policy.memoryEnabled, aiMode: policy.aiMode, rules: policy.rules };
      }
      if (!clinicalApproved()) fail('failed-precondition', 'Jev consultation is disabled.');
      if (!validRequestId(data?.requestId) || !validBedId(data?.bedId) ||
          !['bed', 'clinicalCrib'].includes(data?.target) ||
          !isCurrentRapaNuiDay(data?.date) ||
          typeof data?.episodeId !== 'string' || !data.episodeId.trim() ||
          data.episodeId.length > 160 ||
          typeof data?.expectedCode !== 'string' ||
          typeof data?.expectedCanonicalLabel !== 'string') {
        fail('invalid-argument', 'Invalid Jev request scope.');
      }
      const hospital = firestore.collection('hospitals').doc(HOSPITAL_ID);
      const recordRef = hospital.collection('dailyRecords').doc(data.date);
      const policyRef = hospital.collection('specialtyPolicies').doc('active');
      const requestRef = hospital.collection('specialtyAiRequests').doc(data.requestId);
      const usageRef = hospital.collection('specialtyAiUsage').doc(data.date.slice(0, 7));
      const uid = context.auth.uid;

      const reservation = await firestore.runTransaction(async transaction => {
        const [recordSnap, policySnap, requestSnap, usageSnap] = await Promise.all([
          transaction.get(recordRef), transaction.get(policyRef),
          transaction.get(requestRef), transaction.get(usageRef),
        ]);
        if (!recordSnap.exists || !policySnap.exists) fail('failed-precondition', 'Jev unavailable.');
        const policy = policySnap.data();
        if (!validatePolicy(policy) || policy.aiMode !== 'consultative' ||
            !Number.isInteger(policy.aiMonthlyLimit) || policy.aiMonthlyLimit < 1) {
          fail('failed-precondition', 'Jev consultation is disabled.');
        }
        const patient = getPatient(recordSnap.data(), data.bedId, data.target);
        if (patient?.clinicalEpisodeId !== data.episodeId) fail('aborted', 'Episode changed.');
        if (patient.specialtyAssignment != null || String(patient.specialty || '').trim()) {
          fail('failed-precondition', 'Specialty already decided.');
        }
        const ruleOutcome = resolvePendingSpecialty(patient, policy);
        if (ruleOutcome.kind === 'assign' ||
            ['manual_required', 'rule_conflict'].includes(ruleOutcome.reason)) {
          fail('failed-precondition', 'A specialty rule requires a different decision path.');
        }
        let evidence;
        try {
          evidence = buildJevEvidence({ date: data.date, bedId: data.bedId,
            target: data.target, patient, policy });
        } catch {
          fail('failed-precondition', 'Jev rubric is not configured.');
        }
        if (!evidence) fail('failed-precondition', 'Jev evidence is incomplete.');
        if (evidence.code !== data.expectedCode ||
            evidence.request.state.diagnosis.label !== data.expectedCanonicalLabel) {
          fail('aborted', 'Diagnosis catalog changed; prepare the consultation again.');
        }
        if (requestSnap.exists) {
          const existing = requestSnap.data();
          if (existing.requesterUid !== uid || existing.digest !== evidence.digest ||
              existing.episodeId !== data.episodeId) {
            fail('aborted', 'Request ID belongs to different evidence.');
          }
          if (existing.status === 'pending' &&
              Number.isFinite(Date.parse(existing.deadlineAt)) &&
              Date.parse(existing.deadlineAt) <= Date.now()) {
            const expiresAt = Date.parse(existing.expiresAt);
            if ((existing.attempt || 1) >= 2 || !Number.isFinite(expiresAt) ||
                expiresAt <= Date.now() + 30_000) {
              transaction.update(requestRef, { status: 'failed',
                errorCode: !Number.isFinite(expiresAt) || expiresAt <= Date.now() + 30_000
                  ? 'JEV_EXPIRED' : 'JEV_TIMEOUT',
                completedAt: new Date().toISOString() });
              return { status: 'failed' };
            }
            // A crashed invocation may be retried once with the same request ID.
            // The quota remains reserved; a late first result cannot replace this attempt.
            const attempt = 2;
            transaction.update(requestRef, { attempt,
              deadlineAt: new Date(Date.now() + 30_000).toISOString() });
            return { status: 'reserved', evidence, attempt };
          }
          if (!Number.isFinite(Date.parse(existing.expiresAt)) ||
              Date.parse(existing.expiresAt) <= Date.now()) {
            fail('aborted', 'Suggestion expired.');
          }
          return { status: existing.status, result: existing.result || null };
        }
        const count = Number(usageSnap.exists ? usageSnap.data().count : 0);
        if (!Number.isInteger(count) || count < 0 || count >= policy.aiMonthlyLimit) {
          fail('resource-exhausted', 'Jev consultation limit reached.');
        }
        const now = Date.now();
        transaction.set(usageRef, { count: count + 1, month: data.date.slice(0, 7) });
        transaction.set(requestRef, {
          status: 'pending', requesterUid: uid, digest: evidence.digest,
          episodeId: evidence.episodeId, date: data.date, bedId: data.bedId,
          target: data.target, policyRevision: policy.revision,
          attempt: 1,
          createdAt: new Date(now).toISOString(), deadlineAt: new Date(now + 30_000).toISOString(),
          expiresAt: new Date(now + 30 * 60_000).toISOString(),
          // Firestore stores Date as Timestamp; the collection-group TTL policy
          // removes clinical request metadata after its acceptance window.
          expireAt: new Date(now + 30 * 60_000),
        });
        return { status: 'reserved', evidence, attempt: 1 };
      });

      if (reservation.status !== 'reserved') {
        if (reservation.status === 'complete') return { status: 'complete', result: reservation.result };
        if (reservation.status === 'pending') return { status: 'pending' };
        return { status: 'unavailable' };
      }
      let result;
      let errorCode;
      try {
        result = await evaluateWithJev(reservation.evidence.request, {
          apiKey: process.env.TYPESAFE_API_KEY,
        });
      } catch (error) {
        errorCode = error instanceof JevAdapterError ? error.code : 'JEV_UNAVAILABLE';
      }

      return firestore.runTransaction(async transaction => {
        const [requestSnap, recordSnap, policySnap] = await Promise.all([
          transaction.get(requestRef), transaction.get(recordRef), transaction.get(policyRef),
        ]);
        if (!requestSnap.exists || requestSnap.data().status !== 'pending' ||
            requestSnap.data().attempt !== reservation.attempt) {
          return { status: 'unavailable' };
        }
        const expiresAt = Date.parse(requestSnap.data().expiresAt);
        const currentPolicy = policySnap.exists ? policySnap.data() : null;
        const currentPatient = recordSnap.exists
          ? getPatient(recordSnap.data(), data.bedId, data.target) : null;
        let fresh = false;
        try {
          fresh = Boolean(currentPolicy && currentPolicy.aiMode === 'consultative' &&
            currentPatient && !currentPatient.specialtyAssignment &&
            !String(currentPatient.specialty || '').trim() &&
            buildJevEvidence({ date: data.date, bedId: data.bedId, target: data.target,
              patient: currentPatient, policy: currentPolicy })?.digest === reservation.evidence.digest);
        } catch { fresh = false; }
        // A transport timeout can occur after Jev received the request. Keep
        // the reserved ID pending so one bounded same-ID retry uses its quota
        // reservation, rather than charging a new request on the next click.
        const expired = !Number.isFinite(expiresAt) || expiresAt <= Date.now();
        const status = expired ? 'failed' : !fresh ? 'obsolete' : result ? 'complete'
          : errorCode === 'JEV_UNAVAILABLE' && reservation.attempt < 2
            ? 'pending' : 'failed';
        transaction.update(requestRef, {
          status, ...(status === 'complete' ? { result } : {}),
          ...(expired ? { errorCode: 'JEV_EXPIRED' } : errorCode ? { errorCode } : {}),
          ...(status === 'pending' ? {} : { completedAt: new Date().toISOString() }),
        });
        return status === 'complete' ? { status, result } : { status };
      });
    }),
});

module.exports = { createSpecialtyJevFunctions };
