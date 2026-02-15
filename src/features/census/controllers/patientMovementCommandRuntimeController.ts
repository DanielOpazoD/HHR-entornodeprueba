import type {
  DischargeCommand,
  DischargeMovementActions,
  TransferCommand,
  TransferMovementActions,
} from '@/features/census/types/censusActionCommandContracts';

type DischargeRuntimeActions = Pick<DischargeMovementActions, 'addDischarge' | 'updateDischarge'>;
type TransferRuntimeActions = Pick<TransferMovementActions, 'addTransfer' | 'updateTransfer'>;

export const executeDischargeRuntimeCommand = (
  command: DischargeCommand,
  actions: DischargeRuntimeActions
): void => {
  if (command.kind === 'updateDischarge') {
    actions.updateDischarge(
      command.id,
      command.payload.status,
      command.payload.type,
      command.payload.typeOther,
      command.payload.time,
      command.payload.movementDate
    );
    return;
  }

  actions.addDischarge(
    command.bedId,
    command.payload.status,
    command.payload.cribStatus,
    command.payload.type,
    command.payload.typeOther,
    command.payload.time,
    command.payload.dischargeTarget
  );
};

export const executeTransferRuntimeCommand = (
  command: TransferCommand,
  actions: TransferRuntimeActions
): void => {
  if (command.kind === 'updateTransfer') {
    actions.updateTransfer(command.id, command.payload);
    return;
  }

  actions.addTransfer(
    command.bedId,
    command.payload.evacuationMethod,
    command.payload.receivingCenter,
    command.payload.receivingCenterOther,
    command.payload.transferEscort,
    command.payload.time
  );
};
