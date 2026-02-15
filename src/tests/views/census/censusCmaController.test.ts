import { describe, expect, it, vi } from 'vitest';
import { DataFactory } from '@/tests/factories/DataFactory';
import {
    buildRestoreCmaDialog,
    CMA_INTERVENTION_TYPES,
    executeUndoCmaController,
    NO_ORIGINAL_DATA_DIALOG
} from '@/features/census/controllers/censusCmaController';

describe('censusCmaController', () => {
    it('exposes stable intervention options', () => {
        expect(CMA_INTERVENTION_TYPES).toEqual([
            'Cirugía Mayor Ambulatoria',
            'Procedimiento Médico Ambulatorio'
        ]);
    });

    it('returns informational outcome when original data is missing', async () => {
        const item = DataFactory.createMockCMA({
            originalBedId: undefined,
            originalData: undefined
        });
        const confirm = vi.fn().mockResolvedValue(true);

        const result = await executeUndoCmaController(item, {
            confirm,
            updatePatientMultiple: vi.fn(),
            deleteCMA: vi.fn()
        });

        expect(result).toEqual({
            ok: true,
            value: { outcome: 'not_restorable' }
        });
        expect(confirm).toHaveBeenCalledWith(NO_ORIGINAL_DATA_DIALOG);
    });

    it('builds restore dialog with patient and bed data', () => {
        const item = DataFactory.createMockCMA({
            patientName: 'Paciente Uno',
            originalBedId: 'R2'
        });

        expect(buildRestoreCmaDialog(item)).toMatchObject({
            title: 'Deshacer Egreso CMA',
            message: '¿Restaurar a Paciente Uno a la cama R2?'
        });
    });

    it('returns cancelled outcome when restore is rejected', async () => {
        const item = DataFactory.createMockCMA({
            originalBedId: 'R1',
            originalData: DataFactory.createMockPatient('R1')
        });

        const updatePatientMultiple = vi.fn();
        const deleteCMA = vi.fn();
        const result = await executeUndoCmaController(item, {
            confirm: vi.fn().mockResolvedValue(false),
            updatePatientMultiple,
            deleteCMA
        });

        expect(result).toEqual({
            ok: true,
            value: { outcome: 'cancelled' }
        });
        expect(updatePatientMultiple).not.toHaveBeenCalled();
        expect(deleteCMA).not.toHaveBeenCalled();
    });

    it('restores patient and deletes CMA entry when confirmed', async () => {
        const originalData = DataFactory.createMockPatient('R3', { patientName: 'Restaurado' });
        const item = DataFactory.createMockCMA({
            id: 'cma-1',
            originalBedId: 'R3',
            originalData
        });

        const updatePatientMultiple = vi.fn();
        const deleteCMA = vi.fn();

        const result = await executeUndoCmaController(item, {
            confirm: vi.fn().mockResolvedValue(true),
            updatePatientMultiple,
            deleteCMA
        });

        expect(result).toEqual({
            ok: true,
            value: { outcome: 'restored' }
        });
        expect(updatePatientMultiple).toHaveBeenCalledWith('R3', originalData);
        expect(deleteCMA).toHaveBeenCalledWith('cma-1');
    });

    it('returns explicit error when confirm dialog rejects', async () => {
        const item = DataFactory.createMockCMA({
            originalBedId: 'R1',
            originalData: DataFactory.createMockPatient('R1')
        });

        const result = await executeUndoCmaController(item, {
            confirm: vi.fn().mockRejectedValue(new Error('dialog failed')),
            updatePatientMultiple: vi.fn(),
            deleteCMA: vi.fn()
        });

        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.error.code).toBe('CONFIRMATION_FAILED');
        }
    });
});
