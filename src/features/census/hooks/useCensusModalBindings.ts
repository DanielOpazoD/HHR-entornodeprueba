import { useMemo } from 'react';
import {
  buildDischargeModalBinding,
  buildMoveCopyModalBinding,
  buildTransferModalBinding,
  type DischargeModalBinding,
  type MoveCopyModalBinding,
  type TransferModalBinding,
} from '@/features/census/controllers/censusModalBindingsController';
import type {
  ActionState,
  DischargeState,
  TransferState,
} from '@/features/census/types/censusActionTypes';

export interface CensusModalBindingsModel {
  moveCopy: MoveCopyModalBinding;
  discharge: DischargeModalBinding;
  transfer: TransferModalBinding;
}

interface UseCensusModalBindingsParams {
  actionState: ActionState;
  dischargeState: DischargeState;
  transferState: TransferState;
}

export const useCensusModalBindings = ({
  actionState,
  dischargeState,
  transferState,
}: UseCensusModalBindingsParams): CensusModalBindingsModel =>
  useMemo(
    () => ({
      moveCopy: buildMoveCopyModalBinding(actionState),
      discharge: buildDischargeModalBinding(dischargeState),
      transfer: buildTransferModalBinding(transferState),
    }),
    [actionState, dischargeState, transferState]
  );
