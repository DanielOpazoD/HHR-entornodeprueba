import type { DailyRecord, DailyRecordPatch } from '@/application/shared/dailyRecordCoreContracts';
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
} from '@/hooks/controllers/bedManagementPatchController';
import {
  buildUpdateClinicalCribCudyrMultiplePatches,
  buildUpdateClinicalCribCudyrPatches,
  buildUpdateCudyrBatchPatches,
  buildUpdateCudyrMultiplePatches,
  buildUpdateCudyrPatches,
} from '@/hooks/controllers/bedManagementCudyrPatchController';
import { buildUpdatePatientActionPatch } from '@/hooks/controllers/bedManagementUpdatePatientController';

export const resolveBedManagementPatch = (
  state: DailyRecord,
  action: BedAction
): DailyRecordPatch | null => {
  switch (action.type) {
    case 'UPDATE_PATIENT':
      return buildUpdatePatientActionPatch(state, action);
    case 'UPDATE_PATIENT_MULTIPLE':
      return buildUpdatePatientPatches(state, action.bedId, action.fields);
    case 'UPDATE_CUDYR':
      return buildUpdateCudyrPatches(state, action.bedId, action.field, action.value);
    case 'UPDATE_CUDYR_MULTIPLE':
      return buildUpdateCudyrMultiplePatches(state, action.bedId, action.fields);
    case 'UPDATE_CUDYR_BATCH':
      return buildUpdateCudyrBatchPatches(state, action.changes);
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
      return buildUpdateClinicalCribPatches(action.bedId, action.field, action.value);
    case 'UPDATE_CLINICAL_CRIB_MULTIPLE':
      return buildClinicalCribMultipleFieldPatches(state, action.bedId, action.fields);
    case 'UPDATE_CLINICAL_CRIB_CUDYR':
      return buildUpdateClinicalCribCudyrPatches(state, action.bedId, action.field, action.value);
    case 'UPDATE_CLINICAL_CRIB_CUDYR_MULTIPLE':
      return buildUpdateClinicalCribCudyrMultiplePatches(state, action.bedId, action.fields);
    case 'TOGGLE_BED_TYPE':
      return buildToggleBedTypePatches(state, action.bedId);
    default:
      return null;
  }
};
