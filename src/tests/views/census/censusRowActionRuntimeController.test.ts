import { describe, expect, it, vi } from 'vitest';
import { DataFactory } from '@/tests/factories/DataFactory';
import type { StabilityRules } from '@/hooks/useStabilityRules';
import { executeRowActionController } from '@/features/census/controllers/censusRowActionRuntimeController';

const unlockedRules: StabilityRules = {
  isDateLocked: false,
  isDayShiftLocked: false,
  isNightShiftLocked: false,
  canEditField: () => true,
  canPerformActions: true,
};

describe('censusRowActionRuntimeController', () => {
  it('returns explicit error when actions are blocked', async () => {
    const result = await executeRowActionController({
      action: 'clear',
      bedId: 'R1',
      patient: DataFactory.createMockPatient('R1', { patientName: 'Paciente 1' }),
      stabilityRules: { ...unlockedRules, canPerformActions: false, lockReason: 'Bloqueado' },
      actions: {
        clearPatient: vi.fn().mockResolvedValue(true),
        addCMA: vi.fn(),
        setMovement: vi.fn(),
        openDischarge: vi.fn(),
        openTransfer: vi.fn(),
      },
      confirmRuntime: { confirm: vi.fn().mockResolvedValue(true) },
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('ACTIONS_LOCKED');
      expect(result.error.message).toBe('Bloqueado');
    }
  });

  it('applies clear when confirm is accepted', async () => {
    const clearPatient = vi.fn().mockResolvedValue(true);
    const result = await executeRowActionController({
      action: 'clear',
      bedId: 'R1',
      patient: DataFactory.createMockPatient('R1', { patientName: 'Paciente 1' }),
      stabilityRules: unlockedRules,
      actions: {
        clearPatient,
        addCMA: vi.fn(),
        setMovement: vi.fn(),
        openDischarge: vi.fn(),
        openTransfer: vi.fn(),
      },
      confirmRuntime: { confirm: vi.fn().mockResolvedValue(true) },
      confirmedLastUpdated: '2026-03-06T10:00:00.000Z',
    });

    expect(result).toEqual({ ok: true, value: { applied: true } });
    expect(clearPatient).toHaveBeenCalledWith('R1', '2026-03-06T10:00:00.000Z');
  });

  it('does not apply clear when confirm is rejected', async () => {
    const clearPatient = vi.fn().mockResolvedValue(true);
    const result = await executeRowActionController({
      action: 'clear',
      bedId: 'R1',
      patient: DataFactory.createMockPatient('R1', { patientName: 'Paciente 1' }),
      stabilityRules: unlockedRules,
      actions: {
        clearPatient,
        addCMA: vi.fn(),
        setMovement: vi.fn(),
        openDischarge: vi.fn(),
        openTransfer: vi.fn(),
      },
      confirmRuntime: { confirm: vi.fn().mockResolvedValue(false) },
    });

    expect(result).toEqual({ ok: true, value: { applied: false } });
    expect(clearPatient).not.toHaveBeenCalled();
  });

  it('does not report a clear as applied when persistence was not confirmed', async () => {
    const clearPatient = vi.fn().mockResolvedValue(false);
    const result = await executeRowActionController({
      action: 'clear',
      bedId: 'R1',
      patient: DataFactory.createMockPatient('R1', { patientName: 'Paciente 1' }),
      stabilityRules: unlockedRules,
      actions: {
        clearPatient,
        addCMA: vi.fn(),
        setMovement: vi.fn(),
        openDischarge: vi.fn(),
        openTransfer: vi.fn(),
      },
      confirmRuntime: { confirm: vi.fn().mockResolvedValue(true) },
    });

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'PERSISTENCE_FAILED',
        message:
          'No fue posible confirmar la limpieza de la cama. Los datos vigentes se conservaron.',
      },
    });
  });

  it('applies movement action immediately', async () => {
    const setMovement = vi.fn();

    const result = await executeRowActionController({
      action: 'move',
      bedId: 'R1',
      patient: DataFactory.createMockPatient('R1', { patientName: 'Paciente 1' }),
      stabilityRules: unlockedRules,
      actions: {
        clearPatient: vi.fn().mockResolvedValue(true),
        addCMA: vi.fn(),
        setMovement,
        openDischarge: vi.fn(),
        openTransfer: vi.fn(),
      },
      confirmRuntime: { confirm: vi.fn().mockResolvedValue(true) },
    });

    expect(result).toEqual({ ok: true, value: { applied: true } });
    expect(setMovement).toHaveBeenCalledWith({
      type: 'move',
      sourceBedId: 'R1',
      targetBedId: null,
    });
  });

  it('applies cma action atomically through addCMA when confirm is accepted', async () => {
    const addCMA = vi.fn();
    const clearPatient = vi.fn().mockResolvedValue(true);

    const result = await executeRowActionController({
      action: 'cma',
      bedId: 'R1',
      patient: DataFactory.createMockPatient('R1', { patientName: 'Paciente 1' }),
      stabilityRules: unlockedRules,
      actions: {
        clearPatient,
        addCMA,
        setMovement: vi.fn(),
        openDischarge: vi.fn(),
        openTransfer: vi.fn(),
      },
      confirmRuntime: { confirm: vi.fn().mockResolvedValue(true) },
    });

    expect(result).toEqual({ ok: true, value: { applied: true } });
    expect(addCMA).toHaveBeenCalledOnce();
    expect(clearPatient).not.toHaveBeenCalled();
  });
});
