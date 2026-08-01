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
    // A missing/unconfigured physician-specialty mapping must never erase a manual HHR value.
    if (field === 'specialty' && (!incoming.treatingPhysicianId || !incoming.specialty)) continue;
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
