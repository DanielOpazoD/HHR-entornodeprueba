import type { DailyRecord, DailyRecordPatch } from '@/application/shared/dailyRecordCoreContracts';
import type { PatientData } from '@/hooks/contracts/patientHookContracts';
import type { PatientFieldValue } from '@/types/valueTypes';
import {
  buildUpdatePatientPatches,
  filterUnchangedBedFieldPatches,
} from '@/hooks/controllers/bedManagementPatchController';

interface UpdatePatientActionInput {
  bedId: string;
  field: keyof PatientData;
  value: PatientFieldValue;
}

export const buildUpdatePatientActionPatch = (
  state: DailyRecord,
  { bedId, field, value }: UpdatePatientActionInput
): DailyRecordPatch => {
  const patches = buildUpdatePatientPatches(state, bedId, {
    [field]: value,
  } as Partial<PatientData>);

  if (field === 'pathology' && value !== state.beds[bedId].pathology) {
    patches[`beds.${bedId}.cie10Code`] = undefined;
    patches[`beds.${bedId}.cie10Description`] = undefined;
  }

  // Segundo diff: los clears de CIE-10 recién agregados también se emiten solo
  // si borran algo; el guard de acompañamiento del filtro re-ancla isUPC si el
  // override sigue presente.
  return filterUnchangedBedFieldPatches(state, bedId, patches) as DailyRecordPatch;
};
