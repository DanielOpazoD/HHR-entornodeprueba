const { HttpsError } = require('firebase-functions/v2/https');
const { createHash } = require('node:crypto');
const { FieldPath } = require('firebase-admin/firestore');
const { dateOnly, text, invalid } = require('./cudyrDischargeContract');
const { episodeContext } = require('./cudyrHistoryContext');
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
/** @returns {{ date: string, clinicalEpisodeId: string, dischargeId?: string, expectedRevision: number, operationId: string, reason: string | null, note: string }} */
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
  const common = {
    expectedRevision: data.expectedRevision,
    operationId: data.operationId,
    reason: data.reason,
    note: text(data.note, 500),
  };
  if (data.dischargeId === undefined)
    return {
      date: dateOnly(data.date),
      clinicalEpisodeId: text(data.clinicalEpisodeId),
      ...common,
    };
  // A discharge without episode is never a CMA bed or a healthy crib by itself.
  if (
    data.clinicalEpisodeId !== undefined ||
    ![null, 'not_hospitalized', 'under_eight_hours'].includes(data.reason)
  )
    invalid();
  return {
    date: dateOnly(data.date),
    clinicalEpisodeId: '',
    dischargeId: text(data.dischargeId, 200),
    ...common,
  };
};
/** Mirrors the client row: an undeleted, named discharge of that day without any episode. */
const hasEpisodelessDischarge = (record, dischargeId) =>
  (record.discharges || []).some(
    movement =>
      !movement.deletedAt &&
      movement.id === dischargeId &&
      !movement.clinicalEpisodeId &&
      !movement.originalData?.clinicalEpisodeId &&
      typeof movement.patientName === 'string' &&
      Boolean(movement.patientName.trim())
  );
/** The callable owns authorization. Decisions affect exactly one confirmed episode/day, or one
 * stored discharge without episode on that day. */
const saveCudyrExclusion = async ({ hospital, data, actor, runTransaction }) => {
  const input = parseExclusion(data);
  const id = input.dischargeId
    ? digest([input.date, 'discharge', input.dischargeId])
    : digest([input.date, input.clinicalEpisodeId]);
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
        throw new HttpsError('already-exists', 'La operación tiene otro contenido.');
      return { persisted: true, exclusion: receipt.data().exclusion };
    }
    if (!record.exists)
      throw new HttpsError('failed-precondition', 'Falta el censo guardado de este día.');
    if (!input.dischargeId) episodeContext(record.data(), input.clinicalEpisodeId);
    else if (!hasEpisodelessDischarge(record.data(), input.dischargeId))
      throw new HttpsError(
        'failed-precondition',
        'El egreso sin episodio no está en el censo guardado de este día.'
      );
    if ((current.exists ? current.data().revision : 0) !== input.expectedRevision)
      throw new HttpsError('aborted', 'La exclusión cambió. Actualice la vista antes de guardar.');
    const exclusion = {
      id,
      date: input.date,
      clinicalEpisodeId: input.clinicalEpisodeId,
      ...(input.dischargeId ? { dischargeId: input.dischargeId } : {}),
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
