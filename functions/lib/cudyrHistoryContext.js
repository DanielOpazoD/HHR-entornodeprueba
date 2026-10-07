const functions = require('firebase-functions/v1');

/** Capture context is server-owned. It is not evidence of the bed at the time of evaluation. */
const episodeContext = (record, clinicalEpisodeId) => {
  const candidates = [];
  const add = (patient, bedId, section) => {
    if (patient?.clinicalEpisodeId === clinicalEpisodeId) {
      const snapshot = { section, bedId, clinicalEpisodeId };
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
        },
        movement.bedId || movement.originalBedId || original?.bedId || '',
        section
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
