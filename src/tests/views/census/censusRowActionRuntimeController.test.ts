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
    expect(clearPatient).toHaveBeenCalledWith(
      'R1',
      '2026-03-06T10:00:00.000Z',
      expect.objectContaining({
        patientName: 'Paciente 1',
        rut: '12345678-9',
        admissionDate: '2026-01-01',
      }),
      null
    );
  });

  it('captures the associated crib identity before clearing the parent bed', async () => {
    const clearPatient = vi.fn().mockResolvedValue(true);
    const confirm = vi.fn().mockResolvedValue(true);
    const patient = DataFactory.createMockPatient('R1', {
      patientName: 'Paciente 1',
      clinicalEpisodeId: 'parent-episode',
    });
    patient.clinicalCrib = DataFactory.createMockPatient('R1', {
      bedMode: 'Cuna',
      patientName: 'RN Uno',
      rut: '22.222.222-2',
      clinicalEpisodeId: 'crib-episode',
    });

    await executeRowActionController({
      action: 'clear',
      bedId: 'R1',
      patient,
      stabilityRules: unlockedRules,
      actions: {
        clearPatient,
        addCMA: vi.fn(),
        setMovement: vi.fn(),
        openDischarge: vi.fn(),
        openTransfer: vi.fn(),
      },
      confirmRuntime: { confirm },
      confirmedLastUpdated: '2026-03-06T10:00:00.000Z',
    });

    expect(clearPatient).toHaveBeenCalledWith(
      'R1',
      '2026-03-06T10:00:00.000Z',
      expect.objectContaining({ clinicalEpisodeId: 'parent-episode' }),
      expect.objectContaining({
        clinicalEpisodeId: 'crib-episode',
        patientName: 'RN Uno',
        rut: '22.222.222-2',
      })
    );
    expect(confirm).toHaveBeenCalledWith(
      expect.objectContaining({
        message: '¿Está seguro de limpiar los datos de esta cama y de su cuna asociada?',
      })
    );
  });

  it('blocks an unidentified associated crib when the confirmed version is missing', async () => {
    const clearPatient = vi.fn().mockResolvedValue(true);
    const patient = DataFactory.createMockPatient('R1', {
      clinicalCrib: DataFactory.createMockPatient('R1', {
        bedMode: 'Cuna',
        clinicalEpisodeId: ' ',
        rut: '',
        patientName: '  ',
      }),
    });

    const result = await executeRowActionController({
      action: 'clear',
      bedId: 'R1',
      patient,
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
      error: expect.objectContaining({
        code: 'PERSISTENCE_FAILED',
        message: expect.stringContaining('Recargue el censo'),
      }),
    });
    expect(clearPatient).not.toHaveBeenCalled();
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

  it('preserves the confirmed occupant identity when the local version is unavailable', async () => {
    const clearPatient = vi.fn().mockResolvedValue(true);
    await executeRowActionController({
      action: 'clear',
      bedId: 'R1',
      patient: DataFactory.createMockPatient('R1', {
        patientName: 'Paciente confirmado',
        rut: '11.111.111-1',
      }),
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

    expect(clearPatient).toHaveBeenCalledWith(
      'R1',
      undefined,
      expect.objectContaining({
        patientName: 'Paciente confirmado',
        rut: '11.111.111-1',
      }),
      null
    );
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
