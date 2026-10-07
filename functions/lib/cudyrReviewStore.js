const functions = require('firebase-functions/v1');
const { FieldPath } = require('firebase-admin/firestore');
const { digest, monthValue } = require('./cudyrSupplementContract');
const fail = (code = 'invalid-argument', message = 'Invalid CUDYR review.') => {
  throw new functions.https.HttpsError(code, message);
};
const text = (value, max, required = true) => {
  if (typeof value !== 'string' || value.length > max || (required && !value.trim())) fail();
  return value;
};
const hash = value => {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) fail();
  return value;
};
const parseReview = data => {
  if (data?.schemaVersion !== 1 || data.hospitalId !== undefined || data.confirmed !== true) fail();
  const month = monthValue(data.month);
  const entryKey = text(data.entryKey, 100);
  if (!/^(category:\d+:\d+|discharge:\d+)$/.test(entryKey)) fail();
  if (!Number.isSafeInteger(data.expectedRevision) || data.expectedRevision < 0) fail();
  const operationId = text(data.operationId, 100);
  if (!/^[a-zA-Z0-9-]{16,100}$/.test(operationId)) fail();
  const decision = data.decision;
  if (!decision || !['link', 'exclude', 'pending'].includes(decision.action)) fail();
  const reason = text(decision.reason, 1000).trim();
  if (reason.length < 10) fail();
  const episodeId = text(decision.episodeId, 200, decision.action === 'link');
  if (decision.action !== 'link' && episodeId !== '') fail();
  const evidence = data.evidence;
  if (
    !evidence ||
    !Array.isArray(evidence.sources) ||
    !evidence.sources.length ||
    evidence.sources.length > 2
  )
    fail();
  const sources = evidence.sources
    .map(source => {
      if (!['categories', 'discharges'].includes(source?.kind)) fail();
      return { kind: source.kind, sha256: hash(source.sha256), name: text(source.name, 240) };
    })
    .sort((a, b) => a.kind.localeCompare(b.kind));
  if (
    new Set(sources.map(s => s.kind)).size !== sources.length ||
    !sources.some(s => s.kind === (entryKey.startsWith('category:') ? 'categories' : 'discharges'))
  )
    fail();
  const from = text(evidence.from, 10),
    to = text(evidence.to, 10);
  const sourceDate = text(evidence.sourceDate, 10);
  for (const date of [from, to, sourceDate]) {
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
      !date.startsWith(month + '-') ||
      !Number.isFinite(Date.parse(date)) ||
      new Date(date).toISOString().slice(0, 10) !== date
    )
      fail();
  }
  if (from > to) fail();
  if (
    entryKey.startsWith('category:') &&
    Number(entryKey.split(':')[2]) !== Number(sourceDate.slice(8))
  )
    fail();
  return {
    month,
    entryKey,
    operationId,
    expectedRevision: data.expectedRevision,
    decision: { action: decision.action, episodeId, reason },
    evidence: {
      sources,
      from,
      to,
      contextHash: hash(evidence.contextHash),
      patientName: text(evidence.patientName, 300, false),
      document: text(evidence.document, 100, false),
      sourceDate,
      sourceValue: text(evidence.sourceValue, 1000, false),
    },
  };
};

/** Documentary deliberation only. Never writes clinical data or certifies the supplied evidence. */
const saveCudyrReview = async ({ hospital, data, actor, runTransaction }) => {
  const input = parseReview(data);
  const id = digest([input.month, input.entryKey]);
  const currentRef = hospital.collection('cudyrMonthlyReviews').doc(id);
  const auditRef = currentRef.collection('revisions').doc(digest([actor.uid, input.operationId]));
  const requestHash = digest(input);
  return runTransaction(async transaction => {
    const [current, receipt] = await Promise.all([
      transaction.get(currentRef),
      transaction.get(auditRef),
    ]);
    if (receipt.exists) {
      if (receipt.data().requestHash !== requestHash)
        fail('already-exists', 'Review operation has different content.');
      return { persisted: true, review: receipt.data().review };
    }
    if ((current.exists ? current.data().revision : 0) !== input.expectedRevision)
      fail('aborted', 'Otra persona modificó esta revisión. Recargue antes de guardar.');
    const review = {
      schemaVersion: 1,
      id,
      month: input.month,
      entryKey: input.entryKey,
      revision: input.expectedRevision + 1,
      decision: input.decision,
      evidence: input.evidence,
      verification: 'user_review',
      updatedAt: new Date().toISOString(),
      reviewedBy: actor,
    };
    transaction.set(currentRef, review);
    transaction.create(auditRef, { requestHash, review });
    return { persisted: true, review };
  });
};
const readCudyrReviews = async (hospital, data) => {
  if (data.hospitalId !== undefined) fail();
  const month = monthValue(data.month);
  const limit = data.limit ?? 100;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) fail();
  let query = hospital
    .collection('cudyrMonthlyReviews')
    .where('month', '==', month)
    .orderBy(FieldPath.documentId());
  if (data.reviewId !== undefined) {
    const ref = hospital.collection('cudyrMonthlyReviews').doc(hash(data.reviewId));
    const current = await ref.get();
    if (!current.exists || current.data().month !== month) fail('not-found', 'Review not found.');
    query = ref.collection('revisions').orderBy(FieldPath.documentId());
  }
  if (data.cursor !== undefined) query = query.startAfter(hash(data.cursor));
  const snapshot = await query.limit(limit + 1).get();
  const reviews = snapshot.docs
    .slice(0, limit)
    .map(doc => (data.reviewId ? doc.data().review : doc.data()));
  return { reviews, nextCursor: snapshot.size > limit ? snapshot.docs[limit - 1].id : null };
};
module.exports = { saveCudyrReview, readCudyrReviews, parseReview };
