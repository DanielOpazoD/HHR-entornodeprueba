const functions = require('firebase-functions/v1');
const { movementContext, epicrisisContext } = require('./cudyrMovementContext');

/** Capture context is server-owned. It is not evidence of the bed at the time of evaluation. */
const episodeContext = (record, clinicalEpisodeId) => {
  const candidates = [];
  const add = (patient, bedId, section, movement) => {
    if (patient?.clinicalEpisodeId === clinicalEpisodeId) {
      const snapshot = {
        section,
        bedId,
        clinicalEpisodeId,
        ...epicrisisContext(patient),
        ...(movement ? movementContext(movement) : {}),
      };
      for (const key of [
        'patientName',
        'firstName',
        'lastName',
        'secondLastName',
        'rut',
        'documentType',
        'pathology',
        'cie10Code',
        'admissionDate',
        'admissionTime',
        'bedName',
        'bedMode',
        'location',
        'specialty',
      ]) {
        if (typeof patient[key] === 'string') snapshot[key] = patient[key];
      }
      candidates.push(snapshot);
    }
  };
  for (const [bedId, patient] of Object.entries(record.beds || {})) {
    add(patient, bedId, 'census');
    add(patient?.clinicalCrib, bedId, 'crib');
  }
  for (const section of ['discharges', 'transfers', 'cma']) {
    for (const movement of record[section] || []) {
      if (movement.deletedAt) continue;
      const id = movement.clinicalEpisodeId || movement.originalData?.clinicalEpisodeId;
      if (id !== clinicalEpisodeId) continue;
      const original =
        movement.originalData?.clinicalEpisodeId && movement.originalData.clinicalEpisodeId !== id
          ? {}
          : movement.originalData;
      add(
        {
          ...original,
          clinicalEpisodeId: id,
          patientName: movement.patientName ?? original?.patientName,
          rut: movement.rut ?? original?.rut,
          pathology: movement.diagnosis ?? original?.pathology,
          bedName: movement.bedName ?? original?.bedName,
          bedMode: movement.isNested ? 'Cuna' : original?.bedMode,
          admissionDate: movement.admissionDate ?? original?.admissionDate,
          specialty: movement.specialty ?? original?.specialty,
        },
        movement.bedId || movement.originalBedId || original?.bedId || '',
        section,
        movement
      );
    }
  }
  if (!candidates.length)
    throw new functions.https.HttpsError(
      'failed-precondition',
      'CUDYR episode is absent from the authoritative census and movements.'
    );
  // Keep all observed contexts: do not guess a winning bed when the episode appears twice.
  return candidates;
};

module.exports = { episodeContext };
