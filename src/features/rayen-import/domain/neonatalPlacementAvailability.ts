import type { PatientData } from '../contracts/rayenDomainContracts';
import type { CensusImportDiff } from '../contracts/censusImportDiff';
export const occupied = (patient: PatientData | undefined) =>
  Boolean(patient?.patientName?.trim() || patient?.clinicalEpisodeId || patient?.isBlocked);

export const plannedCribOccupied = (diff: CensusImportDiff, bedId: string): boolean =>
  Boolean(
    diff.admissions.some(a => a.bedId === bedId && occupied(a.patient.clinicalCrib)) ||
    diff.activeClinicalCribs?.some(c => c.parentBedId === bedId && occupied(c.patient)) ||
    diff.updates.some(
      u =>
        u.bedId === bedId &&
        u.changes.some(c => c.field === 'clinicalCrib' && occupied(c.to as PatientData | undefined))
    )
  );
