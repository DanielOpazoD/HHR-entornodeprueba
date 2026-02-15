import {
    DISCHARGE_TYPE_OTHER,
    EVACUATION_METHOD_AEROCARDAL,
    EVACUATION_METHOD_OTHER,
    RECEIVING_CENTER_EXTRASYSTEM,
    RECEIVING_CENTER_OTHER,
    DischargeStatus,
    EvacuationMethod,
    ReceivingCenter
} from '@/constants';
import { TimeSchema } from '@/schemas/inputSchemas';

export type CensusActionValidationError =
    | { code: 'INVALID_TIME_FORMAT'; field: 'time'; message: string }
    | { code: 'DISCHARGE_TYPE_OTHER_REQUIRED'; field: 'typeOther'; message: string }
    | { code: 'TRANSFER_RECEIVING_CENTER_OTHER_REQUIRED'; field: 'receivingCenterOther'; message: string }
    | { code: 'TRANSFER_EVACUATION_METHOD_OTHER_REQUIRED'; field: 'evacuationMethodOther'; message: string }
    | { code: 'TRANSFER_ESCORT_REQUIRED'; field: 'transferEscort'; message: string };

export type CensusActionValidationErrorCode = CensusActionValidationError['code'];

interface DischargeValidationInput {
    status: DischargeStatus;
    type?: string;
    typeOther?: string;
    time: string;
}

interface TransferValidationInput {
    evacuationMethod: EvacuationMethod;
    evacuationMethodOther?: string;
    receivingCenter: ReceivingCenter;
    receivingCenterOther?: string;
    transferEscort?: string;
    time: string;
}

export const normalizeOptionalText = (value?: string): string | undefined => {
    if (!value) {
        return undefined;
    }

    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
};

export const validateDischargeExecutionInput = ({
    status,
    type,
    typeOther,
    time
}: DischargeValidationInput): CensusActionValidationError[] => {
    const errors: CensusActionValidationError[] = [];

    const timeResult = TimeSchema.safeParse(time);
    if (!timeResult.success) {
        errors.push({
            code: 'INVALID_TIME_FORMAT',
            field: 'time',
            message: timeResult.error.issues[0]?.message || 'Formato de hora inválido. Use HH:mm (24h).'
        });
    }

    if (status === 'Vivo' && normalizeOptionalText(type) === DISCHARGE_TYPE_OTHER && !normalizeOptionalText(typeOther)) {
        errors.push({
            code: 'DISCHARGE_TYPE_OTHER_REQUIRED',
            field: 'typeOther',
            message: 'Debe especificar el detalle cuando el tipo de alta es "Otra".'
        });
    }

    return errors;
};

export const validateTransferExecutionInput = ({
    evacuationMethod,
    evacuationMethodOther,
    receivingCenter,
    receivingCenterOther,
    transferEscort,
    time
}: TransferValidationInput): CensusActionValidationError[] => {
    const errors: CensusActionValidationError[] = [];

    const timeResult = TimeSchema.safeParse(time);
    if (!timeResult.success) {
        errors.push({
            code: 'INVALID_TIME_FORMAT',
            field: 'time',
            message: timeResult.error.issues[0]?.message || 'Formato de hora inválido. Use HH:mm (24h).'
        });
    }

    if (evacuationMethod === EVACUATION_METHOD_OTHER && !normalizeOptionalText(evacuationMethodOther)) {
        errors.push({
            code: 'TRANSFER_EVACUATION_METHOD_OTHER_REQUIRED',
            field: 'evacuationMethodOther',
            message: 'Debe especificar el método cuando selecciona "Otro".'
        });
    }

    if (
        (receivingCenter === RECEIVING_CENTER_OTHER || receivingCenter === RECEIVING_CENTER_EXTRASYSTEM)
        && !normalizeOptionalText(receivingCenterOther)
    ) {
        errors.push({
            code: 'TRANSFER_RECEIVING_CENTER_OTHER_REQUIRED',
            field: 'receivingCenterOther',
            message: 'Debe especificar el centro receptor seleccionado.'
        });
    }

    if (evacuationMethod !== EVACUATION_METHOD_AEROCARDAL && !normalizeOptionalText(transferEscort)) {
        errors.push({
            code: 'TRANSFER_ESCORT_REQUIRED',
            field: 'transferEscort',
            message: 'Debe indicar acompañante para registrar el traslado.'
        });
    }

    return errors;
};
