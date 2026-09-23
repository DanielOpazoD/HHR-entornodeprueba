// Fuente de verdad: el CONTRATO ÚNICO de autoridad, compartido con el cliente.
const {
  RAYEN_MANUALLY_MANAGED_DEVICE_FIELDS,
  RAYEN_BATCH_ONLY_CLINICAL_FIELDS,
  RAYEN_CLINICAL_FIELDS,
} = require('./dailyRecordAuthorityContract');
const { normalizeStoredAssignment } = require('./specialtyAssignmentContract');

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

/**
 * Reconcilia la decisión de especialidad de un paciente entrante contra la
 * autoridad remota del MISMO episodio:
 *
 * - La revisión monótona decide: una decisión entrante más nueva gana (es la
 *   corrección manual legítima); una copia atrasada nunca pisa la remota.
 * - Una copia sin metadatos (cliente antiguo) nunca borra una decisión remota
 *   almacenada: se restauran `specialtyAssignment` y, cuando la decisión
 *   remota está bloqueada, también el escalar `specialty`.
 * - Sin metadatos en ninguno de los lados (paciente legacy sin decisión
 *   confirmada), la entrante gana — compatibilidad con el guardado actual.
 */
const reconcilePatientSpecialtyAssignment = (incomingPatient, remotePatient) => {
  if (!isPlainObject(incomingPatient) || !isPlainObject(remotePatient)) {
    return incomingPatient;
  }
  const remoteStored = normalizeStoredAssignment(remotePatient.specialtyAssignment);
  const incomingStored = normalizeStoredAssignment(incomingPatient.specialtyAssignment);
  const remoteEpisodeId = String(remotePatient.clinicalEpisodeId ?? '').trim();
  const incomingEpisodeId = String(incomingPatient.clinicalEpisodeId ?? '').trim();

  if (!remoteEpisodeId || remoteEpisodeId !== incomingEpisodeId) {
    // Episodio distinto (reingreso/recambio): la decisión remota no aplica.
    return incomingPatient;
  }
  if (incomingStored && (!remoteStored || incomingStored.revision > remoteStored.revision)) {
    return incomingPatient;
  }
  if (!remoteStored) return incomingPatient;

  const next = clonePlainValue(incomingPatient);
  next.specialtyAssignment = clonePlainValue(remoteStored);
  if (remoteStored.state === 'manual_locked' || remoteStored.state === 'automatic_locked') {
    next.specialty = remoteStored.value;
  }
  return next;
};

/**
 * Preservación por episodio de la decisión de especialidad en guardados
 * completos. Se aplica SIEMPRE (no depende de la valla Rayen): es un
 * reconciliado monótono que solo protege metadatos ya confirmados; las copias
 * atrasadas y los clientes antiguos no pueden degradarlos.
 */
const preserveSpecialtyAssignments = ({ remoteRecord, incomingRecord }) => {
  const nextRecord = clonePlainValue(incomingRecord);
  const remotePatients = collectRemotePatients(remoteRecord);
  const incomingBeds = isPlainObject(nextRecord?.beds) ? nextRecord.beds : {};

  Object.entries(incomingBeds).forEach(([bedId, bed]) => {
    if (!isPlainObject(bed)) return;
    const key = episodeKey(bed, false);
    const remotePatient = key ? remotePatients.get(key) : null;
    let nextBed = remotePatient ? reconcilePatientSpecialtyAssignment(bed, remotePatient) : bed;
    if (isPlainObject(bed.clinicalCrib)) {
      const cribKey = episodeKey(bed.clinicalCrib, true);
      const remoteCrib = cribKey ? remotePatients.get(cribKey) : null;
      nextBed = { ...nextBed };
      nextBed.clinicalCrib = remoteCrib
        ? reconcilePatientSpecialtyAssignment(bed.clinicalCrib, remoteCrib)
        : bed.clinicalCrib;
    }
    incomingBeds[bedId] = nextBed;
  });

  nextRecord.beds = incomingBeds;
  return nextRecord;
};

const BACKUP_RESTORE_ORIGIN = 'backup_restore';

/**
 * The fence protects clinical fields that already live in the authoritative remote day. When an
 * administrator restores a backup into a day that no longer exists there is nothing remote to
 * protect: stripping the fields would silently discard the only surviving copy of the vitals,
 * devices and scales. Every other create path (blank day, copy from previous day, nurse writes)
 * keeps the fence so the Rayen batch remains the single clinical authority.
 */
const isAdminBackupRestoreOfMissingDay = ({ snapshot, origin, role }) =>
  snapshot?.exists !== true && origin === BACKUP_RESTORE_ORIGIN && role === 'admin';

const shouldPreserveRayenClinicalFields = ({ policySnapshot, snapshot, origin, role }) =>
  isRayenClinicalWriteFenceActive(policySnapshot) &&
  !isAdminBackupRestoreOfMissingDay({ snapshot, origin, role });

module.exports = {
  BACKUP_RESTORE_ORIGIN,
  isAdminBackupRestoreOfMissingDay,
  shouldPreserveRayenClinicalFields,
  RAYEN_CLINICAL_FIELDS,
  RAYEN_BATCH_ONLY_CLINICAL_FIELDS,
  RAYEN_MANUALLY_MANAGED_DEVICE_FIELDS,
  isRayenClinicalBatchEnforced,
  isRayenClinicalWriteFenceActive,
  preserveRayenClinicalFields,
  preserveSpecialtyAssignments,
  reconcilePatientSpecialtyAssignment,
};
