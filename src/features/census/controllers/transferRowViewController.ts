import type { TransferData } from '@/features/census/contracts/censusMovementContracts';
import type { TransferRowViewModel } from '@/features/census/types/censusMovementRowViewModelTypes';
import {
  buildTransferRowActions,
  getTransferCenterLabel,
  getTransferEscortLabel,
} from '@/features/census/controllers/censusTransfersTableController';
import { normalizeCribDisplayText } from '@/services/terminology/cribTerminology';

interface TransferRowActionHandlers {
  undoTransfer: (id: string) => void | Promise<void>;
  editTransfer: (transfer: TransferData) => void | Promise<void>;
  deleteTransfer: (id: string) => void | Promise<void>;
  convertTransferToHomeDischarge?: (id: string) => void | Promise<void>;
  convertTransferToCma?: (id: string) => void | Promise<void>;
}

export const resolveTransferRowViewModel = (
  item: TransferData,
  handlers: TransferRowActionHandlers
): TransferRowViewModel => ({
  kind: 'transfer',
  id: item.id,
  bedName: normalizeCribDisplayText(item.bedName),
  bedType: item.bedType,
  patientName: item.patientName,
  rut: item.rut,
  diagnosis: item.diagnosis,
  movementDate: item.movementDate,
  movementTime: item.time,
  movementProvenance: item.movementProvenance,
  evacuationMethodLabel: item.evacuationMethod,
  receivingCenterLabel: getTransferCenterLabel(item),
  transferEscortLabel: getTransferEscortLabel(item),
  actions: buildTransferRowActions(item, handlers),
});
