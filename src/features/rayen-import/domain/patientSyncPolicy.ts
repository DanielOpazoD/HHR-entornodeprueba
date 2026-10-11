import { isNeonatalPatient } from './clinicalCribMaternalAssociation';
import type { FieldChange } from '../contracts/censusImportDiff';
import type { PatientData } from '../contracts/rayenDomainContracts';
import { normalizeRut } from '@/utils/rutUtils';
import { isDismissedTreatingPhysician } from '@/shared/census/treatingPhysicianDismissal';

/** Rayen-owned fields. Specialty (including a manual blank) belongs to HHR server decisions. */
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
  const dismissedPhysician = isDismissedTreatingPhysician(current, incoming);
  for (const field of SYNCABLE_FIELDS) {
    if (
      dismissedPhysician &&
      (field === 'treatingPhysicianId' || field === 'treatingPhysicianName')
    )
      continue;
    const from = current[field];
    const to = incoming[field];
    if (field === 'clinicalEpisodeId' && !incoming.clinicalEpisodeId) continue;
    // Missing bridge coding is not an instruction to erase locally curated CIE-10 data.
    if ((field === 'cie10Code' || field === 'cie10Description') && !incoming.cie10Code) continue;
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
  if (
    incoming.neonatalMaternalRut &&
    current.neonatalMaternalRut !== incoming.neonatalMaternalRut
  ) {
    changes.push({
      field: 'neonatalMaternalRut',
      from: current.neonatalMaternalRut,
      to: incoming.neonatalMaternalRut,
    });
  }
  // Keep identity status consistent for this exact neonatal episode.
  if (
    (isNeonatalPatient(current) || isNeonatalPatient(incoming)) &&
    current.clinicalEpisodeId === incoming.clinicalEpisodeId &&
    incoming.identityStatus &&
    current.identityStatus !== incoming.identityStatus
  ) {
    changes.push({
      field: 'identityStatus',
      from: current.identityStatus,
      to: incoming.identityStatus,
    });
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

/** Preserve the fresh decision when applying a whole-crib update from an older preview. */
const preserveClinicalCribSpecialty = (
  current: PatientData | undefined,
  incoming: PatientData | undefined
): PatientData | undefined => {
  const sameCrib =
    current &&
    incoming &&
    (current.clinicalEpisodeId
      ? current.clinicalEpisodeId === incoming.clinicalEpisodeId
      : Boolean(
          normalizeRut(current.rut) &&
          normalizeRut(current.rut) === normalizeRut(incoming.rut) &&
          current.admissionDate &&
          current.admissionDate === incoming.admissionDate &&
          (current.admissionTime ?? '') === (incoming.admissionTime ?? '')
        ));
  return sameCrib
    ? {
        ...incoming,
        specialty: current.specialty,
        specialtyAssignment: current.specialtyAssignment,
      }
    : incoming;
};

/** Apply a reviewed diff without turning source suggestions into specialty decisions. */
export const applyReviewedPatientChanges = (
  current: PatientData,
  incoming: PatientData,
  changes: FieldChange[]
): PatientData => {
  const merged = { ...current } as unknown as Record<string, unknown>;
  for (const change of changes) {
    if (change.field === 'specialty' || change.field === 'specialtyAssignment') continue;
    if (
      (change.field === 'treatingPhysicianId' || change.field === 'treatingPhysicianName') &&
      isDismissedTreatingPhysician(current, incoming)
    )
      continue;
    merged[change.field] =
      change.field === 'clinicalCrib'
        ? preserveClinicalCribSpecialty(current.clinicalCrib, change.to as PatientData | undefined)
        : change.to;
  }
  return merged as unknown as PatientData;
};
