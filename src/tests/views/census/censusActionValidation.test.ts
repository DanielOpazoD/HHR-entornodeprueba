import { describe, expect, it } from 'vitest';
import {
    EVACUATION_METHOD_OTHER,
    RECEIVING_CENTER_OTHER,
    DEFAULT_EVACUATION_METHOD,
    DEFAULT_RECEIVING_CENTER,
    DEFAULT_TRANSFER_ESCORT
} from '@/constants';
import {
    normalizeOptionalText,
    validateDischargeExecutionInput,
    validateTransferExecutionInput
} from '@/features/census/validation/censusActionValidation';

describe('censusActionValidation', () => {
    it('normalizes optional text values', () => {
        expect(normalizeOptionalText(undefined)).toBeUndefined();
        expect(normalizeOptionalText('   ')).toBeUndefined();
        expect(normalizeOptionalText('  abc  ')).toBe('abc');
    });

    it('validates discharge time and "Otra" details', () => {
        const errors = validateDischargeExecutionInput({
            status: 'Vivo',
            type: 'Otra',
            typeOther: '   ',
            time: '25:00'
        });

        expect(errors.map(error => error.code)).toEqual([
            'INVALID_TIME_FORMAT',
            'DISCHARGE_TYPE_OTHER_REQUIRED'
        ]);
    });

    it('returns no discharge validation errors for valid payload', () => {
        const errors = validateDischargeExecutionInput({
            status: 'Vivo',
            type: 'Domicilio (Habitual)',
            typeOther: undefined,
            time: '10:30'
        });

        expect(errors).toEqual([]);
    });

    it('validates transfer dependent fields and time', () => {
        const errors = validateTransferExecutionInput({
            evacuationMethod: EVACUATION_METHOD_OTHER,
            evacuationMethodOther: '',
            receivingCenter: RECEIVING_CENTER_OTHER,
            receivingCenterOther: '',
            transferEscort: '',
            time: '30:61'
        });

        expect(errors.map(error => error.code)).toEqual([
            'INVALID_TIME_FORMAT',
            'TRANSFER_EVACUATION_METHOD_OTHER_REQUIRED',
            'TRANSFER_RECEIVING_CENTER_OTHER_REQUIRED',
            'TRANSFER_ESCORT_REQUIRED'
        ]);
    });

    it('returns no transfer validation errors for valid payload', () => {
        const errors = validateTransferExecutionInput({
            evacuationMethod: DEFAULT_EVACUATION_METHOD,
            evacuationMethodOther: '',
            receivingCenter: DEFAULT_RECEIVING_CENTER,
            receivingCenterOther: '',
            transferEscort: DEFAULT_TRANSFER_ESCORT,
            time: '09:15'
        });

        expect(errors).toEqual([]);
    });
});
