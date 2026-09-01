// Campos que el lote clínico Rayen escribe, separados por gobernanza:
// - Los dispositivos son datos operacionales que enfermería TAMBIÉN gestiona a
//   mano entre corridas (agregar/retirar VVP, LA, SNG…): un parche parcial de
//   rol autorizado puede editarlos directamente.
// - Las mediciones y el checkpoint son exclusivos del lote autoritativo: la
//   valla los protege de cualquier escritura no guardada.
const RAYEN_MANUALLY_MANAGED_DEVICE_FIELDS = Object.freeze([
  'devices',
  'deviceDetails',
  'deviceInstanceHistory',
]);

const RAYEN_BATCH_ONLY_CLINICAL_FIELDS = Object.freeze([
  'evaluationScores',
  'vitalSigns',
  'vitalSignsHistory',
  'clinicalSyncCheckpoint',
]);

const RAYEN_CLINICAL_FIELDS = Object.freeze([
  ...RAYEN_MANUALLY_MANAGED_DEVICE_FIELDS,
  ...RAYEN_BATCH_ONLY_CLINICAL_FIELDS,
]);

const isPlainObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);

const clonePlainValue = value => {
  if (Array.isArray(value)) return value.map(clonePlainValue);
  if (value instanceof Date || typeof value?.toDate === 'function') return value;
  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, nested]) => [key, clonePlainValue(nested)])
    );
  }
  return value;
};

const episodeKey = (patient, clinicalCrib) => {
  const clinicalEpisodeId = String(patient?.clinicalEpisodeId || '').trim();
  return clinicalEpisodeId ? `${clinicalCrib ? 'crib' : 'patient'}:${clinicalEpisodeId}` : null;
};

const collectRemotePatients = record => {
  const patients = new Map();
  Object.values(isPlainObject(record?.beds) ? record.beds : {}).forEach(bed => {
    if (!isPlainObject(bed)) return;
    const patientKey = episodeKey(bed, false);
    if (patientKey) patients.set(patientKey, bed);
    if (isPlainObject(bed.clinicalCrib)) {
      const cribKey = episodeKey(bed.clinicalCrib, true);
      if (cribKey) patients.set(cribKey, bed.clinicalCrib);
    }
  });
  return patients;
};

const preservePatientClinicalFields = (incomingPatient, remotePatients, clinicalCrib, fields) => {
  if (!isPlainObject(incomingPatient)) return incomingPatient;
  const nextPatient = clonePlainValue(incomingPatient);
  const key = episodeKey(incomingPatient, clinicalCrib);
  const remotePatient = key ? remotePatients.get(key) : null;

  fields.forEach(field => {
    if (remotePatient && Object.prototype.hasOwnProperty.call(remotePatient, field)) {
      nextPatient[field] = clonePlainValue(remotePatient[field]);
    } else {
      delete nextPatient[field];
    }
  });

  return nextPatient;
};

/**
 * Full-record saves remain responsible for census structure, but never for fields owned by the
 * authoritative Rayen clinical batch. Matching by episode (not bed) preserves data across moves.
 */
const preserveRayenClinicalFields = ({ remoteRecord, incomingRecord, fields }) => {
  const preservedFields = Array.isArray(fields) && fields.length ? fields : RAYEN_CLINICAL_FIELDS;
  const nextRecord = clonePlainValue(incomingRecord);
  const remotePatients = collectRemotePatients(remoteRecord);
  const incomingBeds = isPlainObject(nextRecord?.beds) ? nextRecord.beds : {};

  Object.entries(incomingBeds).forEach(([bedId, bed]) => {
    if (!isPlainObject(bed)) return;
    const nextBed = preservePatientClinicalFields(bed, remotePatients, false, preservedFields);
    if (isPlainObject(bed.clinicalCrib)) {
      nextBed.clinicalCrib = preservePatientClinicalFields(
        bed.clinicalCrib,
        remotePatients,
        true,
        preservedFields
      );
    }
    incomingBeds[bedId] = nextBed;
  });

  nextRecord.beds = incomingBeds;
  return nextRecord;
};

const isRayenClinicalBatchEnforced = policySnapshot => {
  if (!policySnapshot?.exists) return false;
  const policy = policySnapshot.data?.() || {};
  return policy.schemaVersion === 2 && policy.clinicalBatchMode === 'enforced';
};

const isRayenClinicalWriteFenceActive = policySnapshot => {
  if (!policySnapshot?.exists) return false;
  const policy = policySnapshot.data?.() || {};
  return policy.schemaVersion === 2;
};

module.exports = {
  RAYEN_CLINICAL_FIELDS,
  RAYEN_BATCH_ONLY_CLINICAL_FIELDS,
  RAYEN_MANUALLY_MANAGED_DEVICE_FIELDS,
  isRayenClinicalBatchEnforced,
  isRayenClinicalWriteFenceActive,
  preserveRayenClinicalFields,
};
