import { describe, expect, it } from 'vitest';
import {
    getDischargeErrorTitle,
    getMoveOrCopyErrorTitle,
    getTransferErrorTitle
} from '@/features/census/controllers/censusActionErrorPresentation';

describe('censusActionErrorPresentation', () => {
    it('returns specific move/copy title for copy persistence failures', () => {
        expect(getMoveOrCopyErrorTitle('COPY_TO_DATE_FAILED')).toBe('No se pudo copiar');
        expect(getMoveOrCopyErrorTitle('RECORD_NOT_AVAILABLE')).toBe('No se pudo mover/copiar');
    });

    it('returns contextual title for discharge validation and lock errors', () => {
        expect(getDischargeErrorTitle('INVALID_TIME_FORMAT')).toBe('Datos de alta incompletos');
        expect(getDischargeErrorTitle('ACTIONS_LOCKED')).toBe('Alta bloqueada');
        expect(getDischargeErrorTitle('DISCHARGE_TARGET_MISSING')).toBe('No se pudo registrar el alta');
    });

    it('returns contextual title for transfer validation and lock errors', () => {
        expect(getTransferErrorTitle('TRANSFER_RECEIVING_CENTER_OTHER_REQUIRED')).toBe('Datos de traslado incompletos');
        expect(getTransferErrorTitle('ACTIONS_LOCKED')).toBe('Traslado bloqueado');
        expect(getTransferErrorTitle('TRANSFER_TARGET_MISSING')).toBe('No se pudo registrar el traslado');
    });
});
