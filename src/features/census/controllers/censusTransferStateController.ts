import {
    EVACUATION_METHOD_AEROCARDAL,
    normalizeEvacuationMethod,
    normalizeReceivingCenter
} from '@/constants';
import type { TransferState } from '@/features/census/types/censusActionTypes';

export type TransferStateFieldUpdate =
    | 'evacuationMethod'
    | 'evacuationMethodOther'
    | 'receivingCenter'
    | 'receivingCenterOther'
    | 'transferEscort';

export const applyTransferStateUpdate = (
    previousState: TransferState,
    field: TransferStateFieldUpdate,
    value: string
): TransferState => {
    switch (field) {
        case 'evacuationMethod':
            return {
                ...previousState,
                evacuationMethod: normalizeEvacuationMethod(value),
                transferEscort: value === EVACUATION_METHOD_AEROCARDAL ? '' : previousState.transferEscort
            };
        case 'receivingCenter':
            return {
                ...previousState,
                receivingCenter: normalizeReceivingCenter(value)
            };
        case 'evacuationMethodOther':
            return { ...previousState, evacuationMethodOther: value };
        case 'receivingCenterOther':
            return { ...previousState, receivingCenterOther: value };
        case 'transferEscort':
            return { ...previousState, transferEscort: value };
    }
};
