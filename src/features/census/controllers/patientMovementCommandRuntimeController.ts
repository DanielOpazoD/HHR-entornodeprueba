import type {
  DischargeCommand,
  DischargeRuntimeActions,
  TransferCommand,
  TransferRuntimeActions,
} from '@/features/census/domain/movements/contracts';

export const executeDischargeRuntimeCommand = (
  command: DischargeCommand,
  actions: DischargeRuntimeActions
): void => {
  if (command.kind === 'addDischarge') {
    actions.addDischarge(command.bedId, command.payload);
    return;
  }

  const { status, type, typeOther, time, movementDate, diagnosis } = command.payload;
  actions.updateDischarge(
    command.id,
    status,
    type,
    typeOther,
    time,
    movementDate,
    undefined,
    diagnosis
  );
};

export const executeTransferRuntimeCommand = (
  command: TransferCommand,
  actions: TransferRuntimeActions
): void => {
  if (command.kind === 'addTransfer') {
    actions.addTransfer(command.bedId, command.payload);
    return;
  }

  actions.updateTransfer(command.id, command.payload);
};
