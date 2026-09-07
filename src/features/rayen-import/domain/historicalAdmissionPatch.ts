import type { DailyRecord, PatientData } from '../contracts/rayenDomainContracts';
import { RAYEN_OWNED_CLINICAL_FIELDS } from '@/types/domain/rayenClinicalFields';

const structuralPatient = (patient: PatientData): PatientData => {
  const result = { ...patient };
  // An admission establishes identity/placement, not measurements from another day.
  // Omitted fields remain owned by the authoritative clinical batch on the target date.
  for (const field of RAYEN_OWNED_CLINICAL_FIELDS) delete result[field];
  if (result.clinicalCrib) result.clinicalCrib = structuralPatient(result.clinicalCrib);
  return result;
};

export const buildHistoricalAdmissionBedsPatch = (
  before: DailyRecord,
  after: DailyRecord
): DailyRecord['beds'] =>
  Object.fromEntries(
    Object.entries(after.beds)
      .filter(([bedId, patient]) => patient !== before.beds[bedId])
      .map(([bedId, patient]) => [bedId, structuralPatient(patient)])
  );
