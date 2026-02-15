import { describe, expect, it } from 'vitest';
import { DataFactory } from '@/tests/factories/DataFactory';
import { StabilityRules } from '@/hooks/useStabilityRules';
import { resolveRowActionCommand } from '@/features/census/controllers/censusRowActionController';

const unlockedRules: StabilityRules = {
    isDateLocked: false,
    isDayShiftLocked: false,
    isNightShiftLocked: false,
    canEditField: () => true,
    canPerformActions: true
};

describe('censusRowActionController', () => {
    it('returns lock error when actions are blocked by stability rules', () => {
        const patient = DataFactory.createMockPatient('R1', { patientName: 'Paciente 1' });

        const result = resolveRowActionCommand({
            action: 'transfer',
            bedId: 'R1',
            patient,
            stabilityRules: { ...unlockedRules, canPerformActions: false, lockReason: 'Registro cerrado' }
        });

        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.error.code).toBe('ACTIONS_LOCKED');
            expect(result.error.message).toBe('Registro cerrado');
        }
    });

    it('resolves clear action as a confirmation command', () => {
        const patient = DataFactory.createMockPatient('R1', { patientName: 'Paciente 1' });

        const result = resolveRowActionCommand({
            action: 'clear',
            bedId: 'R1',
            patient,
            stabilityRules: unlockedRules
        });

        expect(result).toEqual({
            ok: true,
            value: {
                kind: 'confirmClear',
                bedId: 'R1',
                confirm: {
                    title: 'Limpiar cama',
                    message: '¿Está seguro de limpiar los datos de esta cama?',
                    confirmText: 'Sí, limpiar',
                    variant: 'warning'
                }
            }
        });
    });

    it('resolves move action with next movement state', () => {
        const patient = DataFactory.createMockPatient('R1', { patientName: 'Paciente 1' });

        const result = resolveRowActionCommand({
            action: 'move',
            bedId: 'R1',
            patient,
            stabilityRules: unlockedRules
        });

        expect(result).toEqual({
            ok: true,
            value: {
                kind: 'setMovement',
                nextActionState: {
                    type: 'move',
                    sourceBedId: 'R1',
                    targetBedId: null
                }
            }
        });
    });

    it('resolves discharge action as modal-open command', () => {
        const patient = DataFactory.createMockPatient('R1', { patientName: 'Paciente 1' });

        const result = resolveRowActionCommand({
            action: 'discharge',
            bedId: 'R1',
            patient,
            stabilityRules: unlockedRules
        });

        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.value.kind).toBe('openDischarge');
            if (result.value.kind === 'openDischarge') {
                expect(result.value.dischargePatch.bedId).toBe('R1');
                expect(result.value.dischargePatch.isOpen).toBe(true);
            }
        }
    });

    it('returns explicit error for CMA when patient name is missing', () => {
        const patient = DataFactory.createMockPatient('R1', { patientName: '' });

        const result = resolveRowActionCommand({
            action: 'cma',
            bedId: 'R1',
            patient,
            stabilityRules: unlockedRules
        });

        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.error.code).toBe('PATIENT_NAME_REQUIRED');
        }
    });
});
