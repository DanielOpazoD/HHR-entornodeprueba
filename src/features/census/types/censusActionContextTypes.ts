import type { Dispatch, ReactNode, SetStateAction } from 'react';
import type { DischargeData, PatientData, TransferData } from '@/types';
import type { PatientRowAction } from '@/features/census/types/patientRowActionTypes';
import type {
  DischargeExecutionInput,
  TransferExecutionInput,
} from '@/features/census/types/censusActionCommandContracts';
import type {
  ActionState,
  DischargeState,
  TransferState,
} from '@/features/census/types/censusActionTypes';

export interface CensusActionStateContextType {
  actionState: ActionState;
  setActionState: Dispatch<SetStateAction<ActionState>>;
  dischargeState: DischargeState;
  setDischargeState: Dispatch<SetStateAction<DischargeState>>;
  transferState: TransferState;
  setTransferState: Dispatch<SetStateAction<TransferState>>;
}

export interface CensusActionCommandsContextType {
  executeMoveOrCopy: (targetDate?: string) => void;
  executeDischarge: (data?: DischargeExecutionInput) => void;
  handleEditDischarge: (d: DischargeData) => void;
  executeTransfer: (data?: TransferExecutionInput) => void;
  handleEditTransfer: (t: TransferData) => void;
  handleRowAction: (action: PatientRowAction, bedId: string, patient: PatientData) => void;
}

export interface CensusActionsProviderProps {
  children: ReactNode;
}
