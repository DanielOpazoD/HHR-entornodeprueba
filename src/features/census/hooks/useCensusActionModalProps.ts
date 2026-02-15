import { useMemo } from 'react';
import type { CensusActionCommandsContextType } from '@/features/census/types/censusActionContextTypes';
import type { CensusModalBindingsModel } from '@/features/census/hooks/useCensusModalBindings';
import type { useCensusModalsHandlers } from '@/features/census/hooks/useCensusModalsHandlers';
import type {
  DischargeModalProps,
  MoveCopyModalProps,
  TransferModalProps,
} from '@/features/census/types/censusActionModalContracts';

type CensusModalsHandlersModel = ReturnType<typeof useCensusModalsHandlers>;

interface UseCensusActionModalPropsParams {
  modalBindings: CensusModalBindingsModel;
  modalHandlers: CensusModalsHandlersModel;
  recordDate: string;
  actionCommands: Pick<
    CensusActionCommandsContextType,
    'executeMoveOrCopy' | 'executeDischarge' | 'executeTransfer'
  >;
}

export interface CensusActionModalPropsModel {
  moveCopyProps: MoveCopyModalProps;
  dischargeProps: DischargeModalProps;
  transferProps: TransferModalProps;
}

export const useCensusActionModalProps = ({
  modalBindings,
  modalHandlers,
  recordDate,
  actionCommands,
}: UseCensusActionModalPropsParams): CensusActionModalPropsModel =>
  useMemo(
    () => ({
      moveCopyProps: {
        isOpen: modalBindings.moveCopy.isOpen,
        type: modalBindings.moveCopy.type,
        sourceBedId: modalBindings.moveCopy.sourceBedId,
        targetBedId: modalBindings.moveCopy.targetBedId,
        onClose: modalHandlers.closeMoveCopy,
        onSetTarget: modalHandlers.setMoveCopyTarget,
        onConfirm: actionCommands.executeMoveOrCopy,
      },
      dischargeProps: {
        isOpen: modalBindings.discharge.isOpen,
        isEditing: modalBindings.discharge.isEditing,
        status: modalBindings.discharge.status,
        hasClinicalCrib: modalBindings.discharge.hasClinicalCrib,
        clinicalCribName: modalBindings.discharge.clinicalCribName,
        clinicalCribStatus: modalBindings.discharge.clinicalCribStatus,
        onClinicalCribStatusChange: modalHandlers.updateDischargeClinicalCribStatus,
        onStatusChange: modalHandlers.updateDischargeStatus,
        dischargeTarget: modalBindings.discharge.dischargeTarget,
        onDischargeTargetChange: modalHandlers.updateDischargeTarget,
        initialType: modalBindings.discharge.initialType,
        initialOtherDetails: modalBindings.discharge.initialOtherDetails,
        initialTime: modalBindings.discharge.initialTime,
        initialMovementDate: modalBindings.discharge.initialMovementDate,
        recordDate,
        onClose: modalHandlers.closeDischarge,
        onConfirm: actionCommands.executeDischarge,
      },
      transferProps: {
        isOpen: modalBindings.transfer.isOpen,
        isEditing: modalBindings.transfer.isEditing,
        evacuationMethod: modalBindings.transfer.evacuationMethod,
        evacuationMethodOther: modalBindings.transfer.evacuationMethodOther,
        receivingCenter: modalBindings.transfer.receivingCenter,
        receivingCenterOther: modalBindings.transfer.receivingCenterOther,
        transferEscort: modalBindings.transfer.transferEscort,
        hasClinicalCrib: modalBindings.transfer.hasClinicalCrib,
        clinicalCribName: modalBindings.transfer.clinicalCribName,
        initialTime: modalBindings.transfer.initialTime,
        initialMovementDate: modalBindings.transfer.initialMovementDate,
        recordDate,
        onUpdate: modalHandlers.updateTransfer,
        onClose: modalHandlers.closeTransfer,
        onConfirm: actionCommands.executeTransfer,
      },
    }),
    [actionCommands, modalBindings, modalHandlers, recordDate]
  );
