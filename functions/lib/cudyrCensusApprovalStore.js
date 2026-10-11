const functions = require('firebase-functions/v1');
const { digest, monthValue } = require('./cudyrSupplementContract');
const fail = (message, code = 'invalid-argument') => {
  throw new functions.https.HttpsError(code, message);
};
const parseCensusApproval = data => {
  const month = monthValue(data.month);
  const last = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5)), 0));
  // Noon on the following day has elapsed in Pacific/Easter, including DST.
  const next = new Date(last.getTime() + 86400000).toISOString().slice(0, 10);
  const local = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Pacific/Easter',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date());
  if (
    data.hospitalId !== undefined ||
    data.schemaVersion !== 1 ||
    data.confirmed !== true ||
    (data.policyVersion !== undefined && ![1, 2].includes(data.policyVersion)) ||
    data.action !== 'approve_census' ||
    local < next + ' 12:00' ||
    !Number.isSafeInteger(data.expectedRevision) ||
    data.expectedRevision < 1 ||
    typeof data.operationId !== 'string' ||
    !/^[a-zA-Z0-9-]{16,100}$/.test(data.operationId) ||
    typeof data.reason !== 'string' ||
    data.reason.trim().length < 20 ||
    data.reason.length > 1800 ||
    !Array.isArray(data.days) ||
    data.days.length !== last.getUTCDate() ||
    data.entries !== undefined ||
    data.files !== undefined ||
    data.evaluation !== undefined
  )
    fail('Invalid reconstructed census approval.');
  const days = data.days.map((day, i) => {
    const date = `${month}-${String(i + 1).padStart(2, '0')}`;
    if (
      day.date !== date ||
      typeof day.fingerprint !== 'string' ||
      !/^[a-f0-9]{64}$/.test(day.fingerprint)
    )
      fail('Every day must have a unique ordered fingerprint.');
    return { date, fingerprint: day.fingerprint };
  });
  return {
    month,
    days,
    policyVersion: data.policyVersion === 2 ? 2 : 1,
    reason: data.reason.trim(),
    expectedRevision: data.expectedRevision,
    operationId: data.operationId,
  };
};

// Authorized human attestation, not a claim of automatic source equality.
const saveCudyrCensusApproval = async ({ hospital, data, actor, runTransaction }) => {
  if (!['admin', 'nurse_hospital'].includes(actor.role))
    fail('Review permission required.', 'permission-denied');
  const input = parseCensusApproval(data);
  const ref = hospital.collection('cudyrVerifiedContexts').doc(input.month);
  const audit = ref.collection('revisions').doc(digest([actor.uid, input.operationId]));
  const requestHash = digest(input);
  return runTransaction(async tx => {
    const receipt = await tx.get(audit);
    if (receipt.exists) {
      if (receipt.data().requestHash !== requestHash)
        fail('Operation content changed.', 'already-exists');
      return { persisted: true, revision: receipt.data().review.revision };
    }
    const prior = await tx.get(ref);
    if (
      !prior.exists ||
      prior.data().verification !== 'reviewed_documentary_context' ||
      !prior.data().entries?.length
    )
      fail('Documentary reconstruction required.', 'failed-precondition');
    if (prior.data().revision !== input.expectedRevision)
      fail('La conciliación cambió; recargue antes de aprobar.', 'aborted');
    const now = new Date().toISOString();
    const review = {
      ...prior.data(),
      revision: input.expectedRevision + 1,
      censusApproval: {
        policyVersion: input.policyVersion,
        days: input.days,
        reason: input.reason,
        approvedAt: now,
        approvedBy: actor,
      },
    };
    // Preserve the original review author/date, documents and all episode corrections.
    tx.set(ref, review);
    tx.create(audit, {
      requestHash,
      action: 'approve_census',
      review,
      recordedAt: now,
    });
    return { persisted: true, revision: review.revision };
  });
};
module.exports = { parseCensusApproval, saveCudyrCensusApproval };
