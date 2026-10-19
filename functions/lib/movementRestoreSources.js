const { isDeepStrictEqual } = require('node:util');
const { RAYEN_CLINICAL_FIELDS } = require('./dailyRecordAuthorityContract');
const text = value => typeof value === 'string' ? value.trim() : '';

const { https } = require('firebase-functions/v1');
const immutableMovement = movement => Object.fromEntries(Object.entries(movement || {})
  .filter(([key]) => !['deletedAt', 'deletedBy', 'deletedReason'].includes(key)));
const isUnchangedMovement = (stored, incoming) =>
  isDeepStrictEqual(immutableMovement(stored), immutableMovement(incoming));
const document = value => text(value).toUpperCase().replace(/[^A-Z0-9]/g, '');
const assertRestoredParent = (remote, candidate, movement, source, parent, list) => {
  if (!isDeepStrictEqual(source, parent?.clinicalCrib)) {
    throw new https.HttpsError('failed-precondition',
      'La cuna restaurada debe conservar los datos originales del egreso.');
  }
  const maternalDocument = document(source.neonatalMaternalRut);
  const parents = (Array.isArray(remote?.[list]) ? remote[list] : []).filter(item =>
    !item.isNested && item.bedId === movement.bedId &&
    text(movement.movementDate) && item.movementDate === movement.movementDate &&
    text(movement.time) && item.time === movement.time &&
    maternalDocument && document(item.originalData?.rut) === maternalDocument &&
    text(item.originalData?.clinicalEpisodeId));
  const original = parents.length === 1 ? parents[0] : null;
  const previousParent = remote?.beds?.[movement.bedId];
  const consumedParent = original && (Array.isArray(candidate?.[list]) ? candidate[list] : []).some(item =>
    item.id === original.id && text(item.deletedAt) && !original.deletedAt &&
    isUnchangedMovement(original, item));
  const sameParent = original &&
    text(parent?.clinicalEpisodeId) === text(original.originalData.clinicalEpisodeId) &&
    document(parent?.rut) === maternalDocument;
  const previousMatches = text(previousParent?.clinicalEpisodeId)
    ? text(previousParent.clinicalEpisodeId) === text(parent?.clinicalEpisodeId)
    : !text(previousParent?.patientName) && consumedParent;
  if (!sameParent || !previousMatches) {
    throw new https.HttpsError('failed-precondition',
      'No se pudo confirmar la madre original de la cuna al restaurar el egreso.');
  }
};

// Only a stored, active movement consumed by this same mutation may provide
// restoration authority. Client snapshots are never used as the source.
const movementRestoreRecord = (remote, candidate) => {
  const matches = new Map();
  for (const list of ['discharges', 'transfers', 'cma']) {
    for (const movement of Array.isArray(remote?.[list]) ? remote[list] : []) {
      if (!text(movement.id) || movement.deletedAt || !text(movement.bedId)) continue;
      const consumed = (Array.isArray(candidate?.[list]) ? candidate[list] : [])
        .filter(item => item.id === movement.id);
      if (consumed.length !== 1 || !text(consumed[0].deletedAt) ||
          !isUnchangedMovement(movement, consumed[0])) continue;
      const source = movement.originalData;
      const nested = movement.isNested === true;
      const bed = candidate?.beds?.[movement.bedId];
      const patient = nested ? bed?.clinicalCrib : bed;
      const remoteBed = remote?.beds?.[movement.bedId];
      const remotePatient = nested ? remoteBed?.clinicalCrib : remoteBed;
      if (text(remotePatient?.patientName) || text(remotePatient?.clinicalEpisodeId)) continue;
      if (!text(source?.clinicalEpisodeId) || !patient ||
          ['clinicalEpisodeId', 'patientName', 'rut', 'admissionDate', 'admissionTime']
            .some(key => text(source[key]) !== text(patient[key]))) continue;
      if (!nested && Object.keys(source).some(key =>
        key !== 'clinicalCrib' && !RAYEN_CLINICAL_FIELDS.includes(key) &&
        !isDeepStrictEqual(source[key], patient[key]))) {
        throw new https.HttpsError('failed-precondition',
          'El paciente restaurado debe conservar los datos originales del egreso.');
      }
      if (nested) assertRestoredParent(remote, candidate, movement, source, bed, list);
      const key = `${movement.bedId}:${nested ? 'crib' : 'bed'}`;
      matches.set(key, [...(matches.get(key) || []), { bedId: movement.bedId, nested, source }]);
    }
  }
  const beds = {};
  for (const entries of matches.values()) {
    if (entries.length !== 1) continue;
    const { bedId, nested, source } = entries[0];
    beds[bedId] = nested ? { ...beds[bedId], clinicalCrib: source }
      : { ...source, clinicalCrib: beds[bedId]?.clinicalCrib };
  }
  return { beds };
};
module.exports = { movementRestoreRecord };
