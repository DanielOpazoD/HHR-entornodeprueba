import { describe, expect, it } from 'vitest';
import {
    DEFAULT_EVACUATION_METHOD,
    DEFAULT_RECEIVING_CENTER,
    DEFAULT_TRANSFER_ESCORT
} from '@/constants';
import {
    buildDischargeEditState,
    buildTransferEditState
} from '@/features/census/controllers/censusEditStateController';

describe('censusEditStateController', () => {
    it('builds discharge edit state with expected mapping', () => {
        const result = buildDischargeEditState({
            id: 'd-1',
            bedName: 'R1',
            bedId: 'R1',
            bedType: 'Básica',
            patientName: 'Paciente 1',
            rut: '1-9',
            diagnosis: 'DX',
            time: '10:15',
            status: 'Vivo',
            dischargeType: 'Otra',
            dischargeTypeOther: 'Detalle'
        });

        expect(result).toEqual({
            bedId: null,
            recordId: 'd-1',
            isOpen: true,
            status: 'Vivo',
            type: 'Otra',
            typeOther: 'Detalle',
            time: '10:15'
        });
    });

    it('builds transfer edit state with defaults for optional fields', () => {
        const result = buildTransferEditState({
            id: 't-1',
            bedName: 'R2',
            bedId: 'R2',
            bedType: 'Básica',
            patientName: 'Paciente 2',
            rut: '2-7',
            diagnosis: 'DX',
            time: '12:00',
            evacuationMethod: 'NOA',
            receivingCenter: 'HBM'
        });

        expect(result).toEqual({
            bedId: null,
            recordId: 't-1',
            isOpen: true,
            evacuationMethod: DEFAULT_EVACUATION_METHOD,
            evacuationMethodOther: '',
            receivingCenter: DEFAULT_RECEIVING_CENTER,
            receivingCenterOther: '',
            transferEscort: DEFAULT_TRANSFER_ESCORT,
            time: '12:00'
        });
    });
});
