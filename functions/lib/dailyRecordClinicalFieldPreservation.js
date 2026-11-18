const { movementRestoreRecord } = require('./movementRestoreSources');
// Fuente de verdad: el CONTRATO ÚNICO de autoridad, compartido con el cliente.
const {
  RAYEN_MANUALLY_MANAGED_DEVICE_FIELDS,
  RAYEN_BATCH_ONLY_CLINICAL_FIELDS,
  RAYEN_CLINICAL_FIELDS,
} = require('./dailyRecordAuthorityContract');

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

const MANUAL_DEVICE_FIELDS = new Set(RAYEN_MANUALLY_MANAGED_DEVICE_FIELDS);

// For `beds.<bed>.<device field>` or `beds.<bed>.clinicalCrib.<device field>` (or a path inside
// that field), copies the incoming field onto the record being saved, or removes it when the
// incoming holder has none: what a patch of that path writes.
const keepIncomingDeviceField = (nextRecord, incomingRecord, path) => {
  const parts = String(path).split('.');
  if (parts[0] !== 'beds' || !parts[1]) return;
  const inCrib = parts[2] === 'clinicalCrib';
  const field = parts[inCrib ? 3 : 2];
  if (!MANUAL_DEVICE_FIELDS.has(field)) return;
  const holderOf = record => {
    const bed = record?.beds?.[parts[1]];
    const holder = inCrib && isPlainObject(bed) ? bed.clinicalCrib : bed;
    return isPlainObject(holder) ? holder : null;
  };
  const target = holderOf(nextRecord);
  const source = holderOf(incomingRecord);
  if (!target) return;
  if (source && Object.prototype.hasOwnProperty.call(source, field)) {
    target[field] = clonePlainValue(source[field]);
  } else {
    delete target[field];
  }
};

/**
 * Full-record saves remain responsible for census structure, but never for fields owned by the
 * authoritative Rayen clinical batch. Matching by episode (not bed) preserves data across moves.
 * Devices are the one exception nurses also manage by hand: the device paths a save names as its
 * own change (`editedPaths`, from its sync contract) keep the incoming value, exactly as the patch
 * callable accepts them online. The queue publishes an offline edit as a full save, so without this
 * the edit was replaced by the stored devices and acknowledged as saved (SAVE-01).
 */
const preserveRayenClinicalFields = ({
  remoteRecord,
  incomingRecord,
  fields,
  editedPaths = [],
}) => {
  const preservedFields = Array.isArray(fields) && fields.length ? fields : RAYEN_CLINICAL_FIELDS;
  const nextRecord = clonePlainValue(incomingRecord);
  const remotePatients = new Map([
    ...collectRemotePatients(movementRestoreRecord(remoteRecord, incomingRecord)),
    ...collectRemotePatients(remoteRecord),
  ]);
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
  editedPaths.forEach(path => keepIncomingDeviceField(nextRecord, incomingRecord, path));
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
};
