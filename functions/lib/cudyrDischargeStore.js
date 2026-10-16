const functions = require('firebase-functions/v1');
const { isDeepStrictEqual } = require('node:util');
const { episodeContext } = require('./cudyrHistoryContext');
const {
  parseDischargeCorrection,
  dischargeKey,
  dischargeAuditKey,
  dateOnly,
  timeOnly,
} = require('./cudyrDischargeContract');

const hospitalStamp = () => {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Pacific/Easter',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(new Date())
      .filter(part => part.type !== 'literal')
      .map(part => [part.type, part.value])
  );
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour}:${parts.minute}`,
  };
};
const assertChronology = (payload, contexts) => {
  const dates = new Set(contexts.map(item => item.admissionDate).filter(Boolean));
  if (dates.size !== 1)
    throw new functions.https.HttpsError(
      'failed-precondition',
      'Episode admission date is missing or conflicting.'
    );
  const admissionDate = dateOnly([...dates][0]);
  const actual = payload.actualDischarge;
  if (!actual) return admissionDate;
  const now = hospitalStamp();
  if (
    actual.date < admissionDate ||
    actual.date > now.date ||
    (actual.date === now.date && actual.time && actual.time > now.time)
  )
    throw new functions.https.HttpsError(
      'invalid-argument',
      'Actual discharge must be between admission and now.'
    );
  if (actual.date === admissionDate && actual.time) {
    const times = new Set(contexts.map(item => item.admissionTime).filter(Boolean));
    if (times.size > 1)
      throw new functions.https.HttpsError(
        'failed-precondition',
        'Episode admission time is conflicting.'
      );
    if (times.size === 1 && actual.time < timeOnly([...times][0]))
      throw new functions.https.HttpsError(
        'invalid-argument',
        'Actual discharge precedes admission.'
      );
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
        throw new functions.https.HttpsError(
          'already-exists',
          'Correction operation has different content.'
        );
      return { success: true, persisted: true, correction: previous.correction };
    }
    if (!record.exists)
      throw new functions.https.HttpsError('failed-precondition', 'Authority census is missing.');
    const contexts = episodeContext(record.data(), payload.clinicalEpisodeId);
    const admissionDate = assertChronology(payload, contexts);
    const previous = current.exists ? current.data() : null;
    const revision = previous?.revision ?? 0;
    if (revision !== payload.expectedRevision)
      throw new functions.https.HttpsError(
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
      throw new functions.https.HttpsError(
        'resource-exhausted',
        'Discharge correction context exceeds its limit.'
      );
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
