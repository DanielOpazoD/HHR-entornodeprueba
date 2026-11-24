import type { PatientData } from '@/types/domain/patient';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { DailyRecordPatch } from '@/types/domain/dailyRecordPatch';
import type { PatientFieldValue } from '@/types/valueTypes';
import type { BedAction } from '@/hooks/contracts/bedManagementActionContracts';
import {
  buildClearAllBedsPatches,
  buildClearPatientPatches,
  buildClinicalCribMultipleFieldPatches,
  buildCopyPatientPatches,
  buildCreateClinicalCribPatches,
  buildMovePatientPatches,
  buildRemoveClinicalCribPatches,
  buildToggleBedTypePatches,
  buildToggleBlockedBedPatches,
  buildToggleExtraBedPatches,
  buildUpdateBlockedReasonPatches,
  buildUpdateClinicalCribPatches,
  buildUpdatePatientPatches,
  filterUnchangedBedFieldPatches,
} from '@/hooks/controllers/bedManagementPatchController';

export type { BedAction } from '@/hooks/contracts/bedManagementActionContracts';

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

  if (field === 'pathology' && value !== state.beds[bedId]?.pathology) {
    patches[`beds.${bedId}.cie10Code`] = undefined;
    patches[`beds.${bedId}.cie10Description`] = undefined;
  }

  // Segundo diff: los clears de CIE-10 recién agregados también se emiten solo
  // si borran algo; el guard de acompañamiento del filtro re-ancla isUPC si el
  // override sigue presente.
  return filterUnchangedBedFieldPatches(state, bedId, patches) as DailyRecordPatch;
};

export const bedManagementReducer = (
  state: DailyRecord | null,
  action: BedAction
): DailyRecordPatch | null => {
  if (!state) return null;

  switch (action.type) {
    case 'UPDATE_PATIENT':
      return buildUpdatePatientActionPatch(state, action);
    case 'UPDATE_PATIENT_MULTIPLE':
      return buildUpdatePatientPatches(state, action.bedId, action.fields);
    case 'CLEAR_PATIENT':
      return buildClearPatientPatches(state, action.bedId);
    case 'CLEAR_ALL_BEDS':
      return buildClearAllBedsPatches(state);
    case 'MOVE_PATIENT':
      return buildMovePatientPatches(state, action.sourceBedId, action.targetBedId);
    case 'COPY_PATIENT':
      return buildCopyPatientPatches(state, action.sourceBedId, action.targetBedId);
    case 'TOGGLE_BLOCK_BED':
      return buildToggleBlockedBedPatches(state, action.bedId, action.reason);
    case 'UPDATE_BLOCKED_REASON':
      return buildUpdateBlockedReasonPatches(action.bedId, action.reason);
    case 'TOGGLE_EXTRA_BED':
      return buildToggleExtraBedPatches(state, action.bedId);
    case 'CREATE_CLINICAL_CRIB':
      return buildCreateClinicalCribPatches(state, action.bedId);
    case 'REMOVE_CLINICAL_CRIB':
      return buildRemoveClinicalCribPatches(action.bedId);
    case 'UPDATE_CLINICAL_CRIB':
      return buildUpdateClinicalCribPatches(state, action.bedId, action.field, action.value);
    case 'UPDATE_CLINICAL_CRIB_MULTIPLE':
      return buildClinicalCribMultipleFieldPatches(state, action.bedId, action.fields);
    case 'TOGGLE_BED_TYPE':
      return buildToggleBedTypePatches(state, action.bedId);
    default:
      return null;
  }
};
