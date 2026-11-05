// @vitest-environment node
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
        markInvalidEpisode: vi.fn(),
        cleanInvalidEpisodePreviousDay: vi.fn().mockResolvedValue(null),
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
        markInvalidEpisode: vi.fn(),
        cleanInvalidEpisodePreviousDay: vi.fn().mockResolvedValue(null),
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
        markInvalidEpisode: vi.fn(),
        cleanInvalidEpisodePreviousDay: vi.fn().mockResolvedValue(null),
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
        markInvalidEpisode: vi.fn(),
        cleanInvalidEpisodePreviousDay: vi.fn().mockResolvedValue(null),
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
        markInvalidEpisode: vi.fn(),
        cleanInvalidEpisodePreviousDay: vi.fn().mockResolvedValue(null),
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
        markInvalidEpisode: vi.fn(),
        cleanInvalidEpisodePreviousDay: vi.fn().mockResolvedValue(null),
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
        markInvalidEpisode: vi.fn(),
        cleanInvalidEpisodePreviousDay: vi.fn().mockResolvedValue(null),
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
        markInvalidEpisode: vi.fn(),
        cleanInvalidEpisodePreviousDay: vi.fn().mockResolvedValue(null),
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
        markInvalidEpisode: vi.fn(),
        cleanInvalidEpisodePreviousDay: vi.fn().mockResolvedValue(null),
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

  describe('paciente no válido', () => {
    const marked = (overrides: Record<string, unknown> = {}) =>
      DataFactory.createMockPatient('BOX2', {
        patientName: 'Paciente Sintética',
        clinicalEpisodeId: '900200',
        ...overrides,
      });
    const runtime = (markInvalidEpisode = vi.fn().mockResolvedValue(undefined)) => ({
      clearPatient: vi.fn().mockResolvedValue(true),
      addCMA: vi.fn(),
      markInvalidEpisode,
      cleanInvalidEpisodePreviousDay: vi.fn().mockResolvedValue(null),
      setMovement: vi.fn(),
      openDischarge: vi.fn(),
      openTransfer: vi.fn(),
    });

    it('marks the episode before clearing the bed', async () => {
      const actions = runtime();
      const order: string[] = [];
      actions.markInvalidEpisode.mockImplementation(async () => void order.push('mark'));
      actions.clearPatient.mockImplementation(async () => (order.push('clear'), true));
      const confirm = vi.fn().mockResolvedValue(true);

      const result = await executeRowActionController({
        action: 'invalid',
        bedId: 'BOX2',
        patient: marked(),
        stabilityRules: unlockedRules,
        actions,
        confirmRuntime: { confirm },
        confirmedLastUpdated: '2026-11-05T16:00:00.000Z',
      });

      expect(result).toEqual({ ok: true, value: { applied: true } });
      expect(confirm).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Paciente no válido', variant: 'danger' })
      );
      expect(actions.markInvalidEpisode).toHaveBeenCalledWith({
        clinicalEpisodeId: '900200',
        bedId: 'BOX2',
      });
      expect(actions.clearPatient).toHaveBeenCalledWith(
        'BOX2',
        '2026-11-05T16:00:00.000Z',
        expect.objectContaining({ clinicalEpisodeId: '900200' }),
        null
      );
      expect(order).toEqual(['mark', 'clear']);
    });

    it('removes nothing when the person cancels or the mark cannot be saved', async () => {
      const cancelled = runtime();
      expect(
        await executeRowActionController({
          action: 'invalid',
          bedId: 'BOX2',
          patient: marked(),
          stabilityRules: unlockedRules,
          actions: cancelled,
          confirmRuntime: { confirm: vi.fn().mockResolvedValue(false) },
        })
      ).toEqual({ ok: true, value: { applied: false } });
      expect(cancelled.markInvalidEpisode).not.toHaveBeenCalled();
      expect(cancelled.clearPatient).not.toHaveBeenCalled();

      const offline = runtime(vi.fn().mockRejectedValue(new Error('offline')));
      const result = await executeRowActionController({
        action: 'invalid',
        bedId: 'BOX2',
        patient: marked(),
        stabilityRules: unlockedRules,
        actions: offline,
        confirmRuntime: { confirm: vi.fn().mockResolvedValue(true) },
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.message).toContain('No se eliminó nada');
      expect(offline.clearPatient).not.toHaveBeenCalled();
    });

    it('clears today and then reports what is left on the previous day', async () => {
      const actions = runtime();
      actions.cleanInvalidEpisodePreviousDay.mockResolvedValue(
        'El 04-11-2026 está firmado y no se modificó.'
      );

      const result = await executeRowActionController({
        action: 'invalid',
        bedId: 'BOX2',
        patient: marked(),
        stabilityRules: unlockedRules,
        actions,
        confirmRuntime: { confirm: vi.fn().mockResolvedValue(true) },
      });

      expect(actions.clearPatient).toHaveBeenCalled();
      expect(actions.cleanInvalidEpisodePreviousDay).toHaveBeenCalledWith('900200');
      expect(result).toEqual({
        ok: false,
        error: {
          code: 'PREVIOUS_DAY_PENDING',
          message: 'El 04-11-2026 está firmado y no se modificó.',
        },
      });
    });

    it('tells the person to finish with «Limpiar» when the bed could not be cleared', async () => {
      const actions = runtime();
      actions.clearPatient.mockResolvedValue(false);

      const result = await executeRowActionController({
        action: 'invalid',
        bedId: 'BOX2',
        patient: marked(),
        stabilityRules: unlockedRules,
        actions,
        confirmRuntime: { confirm: vi.fn().mockResolvedValue(true) },
      });

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.message).toContain('Usa «Limpiar»');
    });

    it('refuses a patient without an Eloísa episode or with an attached crib', async () => {
      for (const [patient, code] of [
        [marked({ clinicalEpisodeId: '' }), 'EPISODE_REQUIRED'],
        [
          marked({ clinicalCrib: DataFactory.createMockPatient('BOX2', { patientName: 'RN' }) }),
          'CLINICAL_CRIB_ATTACHED',
        ],
      ] as const) {
        const actions = runtime();
        const result = await executeRowActionController({
          action: 'invalid',
          bedId: 'BOX2',
          patient,
          stabilityRules: unlockedRules,
          actions,
          confirmRuntime: { confirm: vi.fn().mockResolvedValue(true) },
        });
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.error.code).toBe(code);
        expect(actions.markInvalidEpisode).not.toHaveBeenCalled();
      }
    });
  });
});
