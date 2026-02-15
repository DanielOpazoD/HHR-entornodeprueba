import { describe, expect, it, vi } from 'vitest';
import {
    executeToggleBedModeController,
    executeToggleClinicalCribController,
    executeToggleCompanionCribController
} from '@/features/census/controllers/patientRowBedConfigRuntimeController';

describe('patientRowBedConfigRuntimeController', () => {
    it('updates bed mode directly when no confirmation is needed', async () => {
        const updatePatient = vi.fn();
        const result = await executeToggleBedModeController({
            bedId: 'R1',
            isCunaMode: true,
            hasCompanion: false,
            actions: { updatePatient },
            dialogs: { confirm: vi.fn() }
        });

        expect(result).toEqual({
            ok: true,
            value: {
                outcome: 'updated',
                nextMode: 'Cama'
            }
        });
        expect(updatePatient).toHaveBeenCalledWith('R1', 'bedMode', 'Cama');
    });

    it('requires confirmation and patches companion when switching to cuna mode', async () => {
        const updatePatient = vi.fn();
        const confirm = vi.fn().mockResolvedValue(true);

        const result = await executeToggleBedModeController({
            bedId: 'R1',
            isCunaMode: false,
            hasCompanion: true,
            actions: { updatePatient },
            dialogs: { confirm }
        });

        expect(result.ok).toBe(true);
        expect(confirm).toHaveBeenCalledTimes(1);
        expect(updatePatient).toHaveBeenNthCalledWith(1, 'R1', 'hasCompanionCrib', false);
        expect(updatePatient).toHaveBeenNthCalledWith(2, 'R1', 'bedMode', 'Cuna');
    });

    it('returns cancelled outcome when user rejects confirmation', async () => {
        const updatePatient = vi.fn();
        const result = await executeToggleBedModeController({
            bedId: 'R1',
            isCunaMode: false,
            hasCompanion: true,
            actions: { updatePatient },
            dialogs: { confirm: vi.fn().mockResolvedValue(false) }
        });

        expect(result).toEqual({
            ok: true,
            value: {
                outcome: 'cancelled',
                nextMode: 'Cuna'
            }
        });
        expect(updatePatient).not.toHaveBeenCalled();
    });

    it('returns explicit error when confirm dialog fails', async () => {
        const result = await executeToggleBedModeController({
            bedId: 'R1',
            isCunaMode: false,
            hasCompanion: true,
            actions: { updatePatient: vi.fn() },
            dialogs: {
                confirm: vi.fn().mockRejectedValue(new Error('dialog failed'))
            }
        });

        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.error.code).toBe('CONFIRMATION_FAILED');
        }
    });

    it('alerts and returns domain error when companion crib is forbidden', async () => {
        const alert = vi.fn().mockResolvedValue(undefined);
        const result = await executeToggleCompanionCribController({
            bedId: 'R1',
            isCunaMode: true,
            hasCompanion: false,
            actions: { updatePatient: vi.fn() },
            dialogs: { alert }
        });

        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.error.code).toBe('COMPANION_NOT_ALLOWED_IN_CUNA');
        }
        expect(alert).toHaveBeenCalledWith(
            expect.stringContaining('No se puede agregar'),
            'Acción no permitida'
        );
    });

    it('returns explicit error when alert cannot be shown', async () => {
        const result = await executeToggleCompanionCribController({
            bedId: 'R1',
            isCunaMode: true,
            hasCompanion: false,
            actions: { updatePatient: vi.fn() },
            dialogs: {
                alert: vi.fn().mockRejectedValue(new Error('alert failed'))
            }
        });

        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.error.code).toBe('ALERT_FAILED');
        }
    });

    it('updates companion crib when command is valid', async () => {
        const updatePatient = vi.fn();
        const result = await executeToggleCompanionCribController({
            bedId: 'R1',
            isCunaMode: false,
            hasCompanion: true,
            actions: { updatePatient },
            dialogs: { alert: vi.fn() }
        });

        expect(result).toEqual({
            ok: true,
            value: {
                outcome: 'updated',
                nextValue: false
            }
        });
        expect(updatePatient).toHaveBeenCalledWith('R1', 'hasCompanionCrib', false);
    });

    it('toggles clinical crib with explicit create/remove action', () => {
        const updateClinicalCrib = vi.fn();

        const createResult = executeToggleClinicalCribController({
            bedId: 'R1',
            hasClinicalCrib: false,
            actions: { updateClinicalCrib }
        });
        expect(createResult).toEqual({ action: 'create' });
        expect(updateClinicalCrib).toHaveBeenCalledWith('R1', 'create');

        const removeResult = executeToggleClinicalCribController({
            bedId: 'R1',
            hasClinicalCrib: true,
            actions: { updateClinicalCrib }
        });
        expect(removeResult).toEqual({ action: 'remove' });
        expect(updateClinicalCrib).toHaveBeenCalledWith('R1', 'remove');
    });
});
