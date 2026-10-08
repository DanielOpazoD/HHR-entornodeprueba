const functions = require('firebase-functions/v1');
const { createHash } = require('node:crypto');
const { FieldPath } = require('firebase-admin/firestore');
const { dateOnly, text, invalid } = require('./cudyrDischargeContract');
const { episodeContext } = require('./cudyrHistoryContext');
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const parseExclusion = data => {
  if (
    !data ||
    data.kind !== 'save-daily-exclusion' ||
    data.schemaVersion !== 1 ||
    data.hospitalId !== undefined ||
    data.confirmed !== true ||
    !Number.isSafeInteger(data.expectedRevision) ||
    data.expectedRevision < 0 ||
    typeof data.operationId !== 'string' ||
    !/^[a-f0-9-]{36}$/.test(data.operationId) ||
    ![null, 'cma', 'healthy_crib', 'not_hospitalized', 'under_eight_hours'].includes(data.reason)
  )
    invalid();
  return {
    date: dateOnly(data.date),
    clinicalEpisodeId: text(data.clinicalEpisodeId),
    expectedRevision: data.expectedRevision,
    operationId: data.operationId,
    reason: data.reason,
    note: text(data.note, 500),
  };
};
/** The callable owns authorization. Decisions affect exactly one confirmed episode/day. */
const saveCudyrExclusion = async ({ hospital, data, actor, runTransaction }) => {
  const input = parseExclusion(data);
  const id = digest([input.date, input.clinicalEpisodeId]);
  const ref = hospital.collection('cudyrDailyExclusions').doc(id);
  const audit = ref.collection('revisions').doc(digest([actor.uid, input.operationId]));
  const requestHash = digest(input);
  return runTransaction(async tx => {
    const [record, current, receipt] = await Promise.all([
      tx.get(hospital.collection('dailyRecords').doc(input.date)),
      tx.get(ref),
      tx.get(audit),
    ]);
    if (receipt.exists) {
      if (receipt.data().requestHash !== requestHash)
        throw new functions.https.HttpsError(
          'already-exists',
          'La operación tiene otro contenido.'
        );
      return { persisted: true, exclusion: receipt.data().exclusion };
    }
    if (!record.exists)
      throw new functions.https.HttpsError(
        'failed-precondition',
        'Falta el censo guardado de este día.'
      );
    episodeContext(record.data(), input.clinicalEpisodeId);
    if ((current.exists ? current.data().revision : 0) !== input.expectedRevision)
      throw new functions.https.HttpsError(
        'aborted',
        'La exclusión cambió. Actualice la vista antes de guardar.'
      );
    const exclusion = {
      id,
      date: input.date,
      clinicalEpisodeId: input.clinicalEpisodeId,
      revision: input.expectedRevision + 1,
      operationId: input.operationId,
      reason: input.reason,
      note: input.note,
      source: 'manual',
      updatedAt: new Date().toISOString(),
      updatedBy: actor,
    };
    tx.set(ref, { ...exclusion, month: input.date.slice(0, 7) });
    tx.create(audit, { requestHash, exclusion });
    return { persisted: true, exclusion };
  });
};
const readCudyrExclusions = async (hospital, data) => {
  if (data.hospitalId !== undefined || typeof data.month !== 'string') invalid();
  dateOnly(data.month + '-01');
  if (data.month.length !== 7) invalid();
  let query = hospital
    .collection('cudyrDailyExclusions')
    .where('month', '==', data.month)
    .orderBy(FieldPath.documentId());
  if (data.cursor !== undefined) {
    if (typeof data.cursor !== 'string' || !/^[a-f0-9]{64}$/.test(data.cursor)) invalid();
    query = query.startAfter(data.cursor);
  }
  const result = await query.limit(101).get();
  return {
    exclusions: result.docs.slice(0, 100).map(doc => doc.data()),
    nextCursor: result.size > 100 ? result.docs[99].id : null,
  };
};
module.exports = { parseExclusion, saveCudyrExclusion, readCudyrExclusions };
