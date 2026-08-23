import type { FieldChange } from '../contracts/censusImportDiff';
import type { PatientData } from '../contracts/rayenDomainContracts';

/** PatientData fields that the sync is allowed to source from Rayen. */
const SYNCABLE_FIELDS: Array<keyof PatientData> = [
  'patientName',
  'firstName',
  'lastName',
  'secondLastName',
  'rut',
  'birthDate',
  'age',
  'biologicalSex',
  'admissionDate',
  'admissionTime',
  'pathology',
  'cie10Code',
  'cie10Description',
  'treatingPhysicianId',
  'treatingPhysicianName',
  'specialty',
  'isIsolated',
  'isolationType',
  'isolationMicroorganism',
  'clinicalEpisodeId',
];

export const diffSyncablePatientFields = (
  current: PatientData,
  incoming: PatientData
): FieldChange[] => {
  const changes: FieldChange[] = [];
  for (const field of SYNCABLE_FIELDS) {
    const from = current[field];
    const to = incoming[field];
    if (field === 'clinicalEpisodeId' && !incoming.clinicalEpisodeId) continue;
    // Missing bridge coding is not an instruction to erase locally curated CIE-10 data.
    if ((field === 'cie10Code' || field === 'cie10Description') && !incoming.cie10Code) continue;
    // Specialty is locally curated in HHR. Rayen may fill an empty value for a new/legacy patient,
    // but a physician change must never replace a specialty already selected by the user.
    if (field === 'specialty' && (String(current.specialty ?? '').trim() || !incoming.specialty))
      continue;
    // No Rayen assignment is not authoritative enough to erase a name-only physician selected
    // manually in HHR. Rayen-backed identities still follow the source when it removes them.
    if (
      field === 'treatingPhysicianName' &&
      !incoming.treatingPhysicianId &&
      !incoming.treatingPhysicianName &&
      !current.treatingPhysicianId &&
      current.treatingPhysicianName
    )
      continue;
    // A transient failure resolving the directory must not erase a previously verified display
    // name while Rayen still reports the exact same stable physician identity.
    if (
      field === 'treatingPhysicianName' &&
      incoming.treatingPhysicianId &&
      incoming.treatingPhysicianId === current.treatingPhysicianId &&
      !incoming.treatingPhysicianName &&
      current.treatingPhysicianName
    )
      continue;
    if (String(from ?? '') !== String(to ?? '')) changes.push({ field, from, to });
  }
  return changes;
};

export const mergeSyncablePatient = (current: PatientData, incoming: PatientData): PatientData => {
  const merged = { ...current };
  for (const change of diffSyncablePatientFields(current, incoming)) {
    (merged as unknown as Record<string, unknown>)[change.field] = change.to;
  }
  return merged;
};
