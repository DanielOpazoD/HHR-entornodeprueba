import type { CudyrBatchUpdate, CudyrScore, CudyrScorePatch } from '@/types/domain/cudyr';
import type { PatientFieldValue } from '@/types/valueTypes';
import { PatientData } from '@/hooks/contracts/patientHookContracts';
import type { ConfirmedBedOccupantIdentity } from '@/types/domain/intentionalBedClear';

export type BedAction =
  | { type: 'UPDATE_PATIENT'; bedId: string; field: keyof PatientData; value: PatientFieldValue }
  | { type: 'UPDATE_PATIENT_MULTIPLE'; bedId: string; fields: Partial<PatientData> }
  | { type: 'UPDATE_CUDYR'; bedId: string; field: keyof CudyrScore; value: number }
  | { type: 'UPDATE_CUDYR_MULTIPLE'; bedId: string; fields: CudyrScorePatch }
  | { type: 'UPDATE_CUDYR_BATCH'; changes: CudyrBatchUpdate }
  | {
      type: 'CLEAR_PATIENT';
      bedId: string;
      confirmedLastUpdated?: string;
      confirmedOccupant?: ConfirmedBedOccupantIdentity;
      confirmedAssociatedCrib?: ConfirmedBedOccupantIdentity | null;
    }
  | { type: 'CLEAR_ALL_BEDS' }
  | { type: 'MOVE_PATIENT'; sourceBedId: string; targetBedId: string }
  | { type: 'COPY_PATIENT'; sourceBedId: string; targetBedId: string }
  | { type: 'TOGGLE_BLOCK_BED'; bedId: string; reason?: string }
  | { type: 'UPDATE_BLOCKED_REASON'; bedId: string; reason: string }
  | { type: 'TOGGLE_EXTRA_BED'; bedId: string }
  | { type: 'CREATE_CLINICAL_CRIB'; bedId: string }
  | {
      type: 'REMOVE_CLINICAL_CRIB';
      bedId: string;
      confirmedLastUpdated?: string;
      confirmedOccupant?: ConfirmedBedOccupantIdentity;
    }
  | {
      type: 'UPDATE_CLINICAL_CRIB';
      bedId: string;
      field: keyof PatientData;
      value: PatientFieldValue;
    }
  | { type: 'UPDATE_CLINICAL_CRIB_MULTIPLE'; bedId: string; fields: Partial<PatientData> }
  | { type: 'UPDATE_CLINICAL_CRIB_CUDYR'; bedId: string; field: keyof CudyrScore; value: number }
  | { type: 'UPDATE_CLINICAL_CRIB_CUDYR_MULTIPLE'; bedId: string; fields: CudyrScorePatch }
  | { type: 'TOGGLE_BED_TYPE'; bedId: string };
