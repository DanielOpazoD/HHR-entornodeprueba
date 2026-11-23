const { HttpsError } = require('firebase-functions/v2/https');
const { isDeepStrictEqual } = require('node:util');
const { episodeContext } = require('./cudyrHistoryContext');
const { hospitalDateTimeParts } = require('./hospitalCalendarDay');
const {
  parseDischargeCorrection,
  dischargeKey,
  dischargeAuditKey,
  dateOnly,
  timeOnly,
} = require('./cudyrDischargeContract');

const assertChronology = (payload, contexts) => {
  const dates = new Set(contexts.map(item => item.admissionDate).filter(Boolean));
  if (dates.size !== 1)
    throw new HttpsError(
      'failed-precondition',
      'Episode admission date is missing or conflicting.'
    );
  const admissionDate = dateOnly([...dates][0]);
  const actual = payload.actualDischarge;
  if (!actual) return admissionDate;
  const now = hospitalDateTimeParts();
  if (
    actual.date < admissionDate ||
    actual.date > now.date ||
    (actual.date === now.date && actual.time && actual.time > now.time)
  )
    throw new HttpsError('invalid-argument', 'Actual discharge must be between admission and now.');
  if (actual.date === admissionDate && actual.time) {
    const times = new Set(contexts.map(item => item.admissionTime).filter(Boolean));
    if (times.size > 1)
      throw new HttpsError('failed-precondition', 'Episode admission time is conflicting.');
    if (times.size === 1 && actual.time < timeOnly([...times][0]))
      throw new HttpsError('invalid-argument', 'Actual discharge precedes admission.');
  }
  return admissionDate;
};

/** Clinical writer authorization is required by the caller before dispatching here. */
const saveDischargeCorrection = async ({
  firestore,
  hospital,
  data,
  actor,
  runTransaction = write => firestore.runTransaction(write),
}) => {
  const payload = parseDischargeCorrection(data);
  const currentRef = hospital
    .collection('cudyrDischargeCorrections')
    .doc(dischargeKey(payload.clinicalEpisodeId));
  const auditRef = hospital
    .collection('cudyrDischargeAudit')
    .doc(dischargeAuditKey(payload.clinicalEpisodeId, payload.operationId));
  return runTransaction(async transaction => {
    const [record, current, previousOperation] = await Promise.all([
      transaction.get(hospital.collection('dailyRecords').doc(payload.authorityDate)),
      transaction.get(currentRef),
      transaction.get(auditRef),
    ]);
    if (previousOperation.exists) {
      const previous = previousOperation.data();
      if (previous.updatedBy.uid !== actor.uid || !isDeepStrictEqual(previous.request, payload))
        throw new HttpsError('already-exists', 'Correction operation has different content.');
      return { success: true, persisted: true, correction: previous.correction };
    }
    if (!record.exists) throw new HttpsError('failed-precondition', 'Authority census is missing.');
    const contexts = episodeContext(record.data(), payload.clinicalEpisodeId);
    const admissionDate = assertChronology(payload, contexts);
    const previous = current.exists ? current.data() : null;
    const revision = previous?.revision ?? 0;
    if (revision !== payload.expectedRevision)
      throw new HttpsError(
        'aborted',
        'Another user changed the actual discharge. Reload before correcting it.'
      );
    const correction = {
      schemaVersion: 1,
      clinicalEpisodeId: payload.clinicalEpisodeId,
      revision: revision + 1,
      operationId: payload.operationId,
      actualDischarge: payload.actualDischarge,
      reason: payload.reason,
      authorityDate: payload.authorityDate,
      admissionDate,
      sourceContexts: contexts.map(context =>
        Object.fromEntries(
          [
            'section',
            'bedId',
            'movementId',
            'movementDate',
            'movementTime',
            'movementRecordedAt',
            'movementSource',
            'epicrisisRegisteredAt',
          ]
            .filter(key => typeof context[key] === 'string')
            .map(key => [key, context[key]])
        )
      ),
      updatedAt: new Date().toISOString(),
      updatedBy: actor,
    };
    if (Buffer.byteLength(JSON.stringify(correction), 'utf8') > 16_000)
      throw new HttpsError('resource-exhausted', 'Discharge correction context exceeds its limit.');
    transaction.set(currentRef, correction);
    // Only official reports containing this episode must be checked again.
    transaction.set(hospital.collection('cudyrArchiveVersions').doc('discharge-' + currentRef.id), {
      clinicalEpisodeId: payload.clinicalEpisodeId,
      operation: auditRef.id,
    });
    // This guard protects a reconstruction whose episodes are not known yet.
    transaction.set(hospital.collection('cudyrArchiveVersions').doc('dischargePublication'), {
      operation: auditRef.id,
    });
    transaction.create(auditRef, {
      ...correction,
      id: auditRef.id,
      previousRevision: revision,
      previousDischarge: previous?.actualDischarge ?? null,
      request: payload,
      correction,
    });
    return { success: true, persisted: true, correction };
  });
};
module.exports = { saveDischargeCorrection };
