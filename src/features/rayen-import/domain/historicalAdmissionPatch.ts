import type { DailyRecord, PatientData } from '../contracts/rayenDomainContracts';
import { RAYEN_OWNED_CLINICAL_FIELDS } from '@/types/domain/rayenClinicalFields';
import {
  CLINICAL_AUTHORITY_BED_FIELDS,
  SERVER_ONLY_CLINICAL_PATCH_FIELDS,
} from '@/services/storage/dailyRecordAuthorityContract';

const clinicalFields = new Set<string>([
  ...RAYEN_OWNED_CLINICAL_FIELDS,
  ...CLINICAL_AUTHORITY_BED_FIELDS,
  ...SERVER_ONLY_CLINICAL_PATCH_FIELDS,
]);

const structuralPatient = (patient: PatientData): PatientData => {
  const result = Object.fromEntries(
    Object.entries(patient).filter(([field]) => !clinicalFields.has(field))
  ) as PatientData;
  // An admission establishes identity/placement, not measurements from another day.
  // Omitted fields remain owned by the authoritative clinical batch on the target date.
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
