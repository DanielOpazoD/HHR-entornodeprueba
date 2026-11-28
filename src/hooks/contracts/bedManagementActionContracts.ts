import type { UpcRoundEvaluation } from '@/domain/upc/upcContracts';
import type { PatientData } from '@/types/domain/patient';

import type { PatientFieldValue } from '@/types/valueTypes';

import type { ConfirmedBedOccupantIdentity } from '@/types/domain/intentionalBedClear';

export type BedAction =
  | { type: 'CONFIRM_UPC_ROUND'; evaluations: readonly UpcRoundEvaluation[] }
  | { type: 'UPDATE_PATIENT'; bedId: string; field: keyof PatientData; value: PatientFieldValue }
  | {
      type: 'UPDATE_PATIENT_MULTIPLE';
      bedId: string;
      fields: Partial<PatientData>;
    }
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
  | {
      type: 'UPDATE_CLINICAL_CRIB_MULTIPLE';
      bedId: string;
      fields: Partial<PatientData>;
    }
  | { type: 'TOGGLE_BED_TYPE'; bedId: string };
