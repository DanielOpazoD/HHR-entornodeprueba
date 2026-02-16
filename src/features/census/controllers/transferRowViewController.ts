import type { TransferData } from '@/types';
import type { TransferRowViewModel } from '@/features/census/types/censusMovementRowViewModelTypes';
import {
  buildTransferRowActions,
  getTransferCenterLabel,
  getTransferEscortLabel,
} from '@/features/census/controllers/censusTransfersTableController';

interface TransferRowActionHandlers {
  undoTransfer: (id: string) => void | Promise<void>;
  editTransfer: (transfer: TransferData) => void | Promise<void>;
  deleteTransfer: (id: string) => void | Promise<void>;
}

export const resolveTransferRowViewModel = (
  item: TransferData,
  handlers: TransferRowActionHandlers
): TransferRowViewModel => ({
  kind: 'transfer',
  id: item.id,
  bedName: item.bedName,
  bedType: item.bedType,
  patientName: item.patientName,
  rut: item.rut,
  diagnosis: item.diagnosis,
  movementDate: item.movementDate,
  movementTime: item.time,
  evacuationMethodLabel: item.evacuationMethod,
  receivingCenterLabel: getTransferCenterLabel(item),
  transferEscortLabel: getTransferEscortLabel(item),
  actions: buildTransferRowActions(item, handlers),
});
