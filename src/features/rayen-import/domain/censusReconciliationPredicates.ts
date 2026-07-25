import type { PatientData } from '../contracts/rayenDomainContracts';
import type { CensusImportDiff } from '../contracts/censusImportDiff';
import type { RayenEncounter } from '../contracts/rayenSnapshot';

export const isOccupiedCensusPatient = (patient: PatientData | undefined): patient is PatientData =>
  !!patient && !!patient.patientName?.trim() && !patient.isBlocked;

export const isDischargedEncounter = (encounter: RayenEncounter): boolean =>
  !!encounter.hasMedicalDischarge ||
  !!encounter.hasNurseDischarge ||
  !!encounter.dischargeDatetime ||
  !!encounter.isDead;

/** True when the generated diff still requires an explicit human decision. */
export const requiresReview = (diff: CensusImportDiff): boolean =>
  diff.conflicts.length > 0 ||
  diff.pendingAdministrativeDischarges.length > 0 ||
  (diff.reportEgresos?.length ?? 0) > 0;
