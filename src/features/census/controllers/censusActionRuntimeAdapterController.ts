import type {
  DischargeRuntimeActions,
  MoveOrCopyRuntimeActions,
  TransferRuntimeActions,
} from '@/features/census/controllers/censusActionRuntimeController';

export const buildMoveOrCopyRuntimeActions = (
  moveOrCopyPatient: MoveOrCopyRuntimeActions['moveOrCopyPatient'],
  copyPatientToDate: MoveOrCopyRuntimeActions['copyPatientToDate']
): MoveOrCopyRuntimeActions => ({
  moveOrCopyPatient,
  copyPatientToDate,
});

export const buildDischargeRuntimeActions = (
  addDischarge: DischargeRuntimeActions['addDischarge'],
  updateDischarge: DischargeRuntimeActions['updateDischarge']
): DischargeRuntimeActions => ({
  addDischarge,
  updateDischarge,
});

export const buildTransferRuntimeActions = (
  addTransfer: TransferRuntimeActions['addTransfer'],
  updateTransfer: TransferRuntimeActions['updateTransfer']
): TransferRuntimeActions => ({
  addTransfer,
  updateTransfer,
});
