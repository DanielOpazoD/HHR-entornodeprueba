import type { DischargeData, TransferData } from '@/types';
import {
    DEFAULT_TRANSFER_ESCORT,
    normalizeEvacuationMethod,
    normalizeReceivingCenter
} from '@/constants';
import type {
    DischargeState,
    TransferState
} from '@/features/census/types/censusActionTypes';

export const buildDischargeEditState = (discharge: DischargeData): DischargeState => ({
    bedId: null,
    recordId: discharge.id,
    isOpen: true,
    status: discharge.status,
    type: discharge.dischargeType,
    typeOther: discharge.dischargeTypeOther,
    time: discharge.time
});

export const buildTransferEditState = (transfer: TransferData): TransferState => ({
    bedId: null,
    recordId: transfer.id,
    isOpen: true,
    evacuationMethod: normalizeEvacuationMethod(transfer.evacuationMethod),
    evacuationMethodOther: '',
    receivingCenter: normalizeReceivingCenter(transfer.receivingCenter),
    receivingCenterOther: transfer.receivingCenterOther || '',
    transferEscort: transfer.transferEscort || DEFAULT_TRANSFER_ESCORT,
    time: transfer.time
});
