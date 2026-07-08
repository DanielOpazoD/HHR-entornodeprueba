import { describe, expect, it, vi } from 'vitest';
import { DataFactory } from '@/tests/factories/DataFactory';
import { buildUndoCmaPatch } from '@/application/census/cmaUndoPatchUseCase';
import {
  buildDeleteCmaDialog,
  buildRestoreCmaDialog,
  CMA_INTERVENTION_TYPES,
  executeDeleteCmaController,
  executeUndoCmaController,
  NO_ORIGINAL_DATA_DIALOG,
} from '@/features/census/controllers/censusCmaController';

describe('censusCmaController', () => {
  it('exposes stable intervention options', () => {
    expect(CMA_INTERVENTION_TYPES).toEqual([
      'Cirugía Mayor Ambulatoria',
      'Procedimiento Médico Ambulatorio',
    ]);
  });

  it('returns informational outcome when original data is missing', async () => {
    const item = DataFactory.createMockCMA({
      originalBedId: undefined,
      originalData: undefined,
    });
    const confirm = vi.fn().mockResolvedValue(true);

    const result = await executeUndoCmaController(item, {
      confirm,
      updatePatientMultiple: vi.fn(),
      deleteCMA: vi.fn(),
    });

    expect(result).toEqual({
      ok: true,
      value: { outcome: 'not_restorable' },
    });
    expect(confirm).toHaveBeenCalledWith(NO_ORIGINAL_DATA_DIALOG);
  });

  it('builds restore dialog with patient and bed data', () => {
    const item = DataFactory.createMockCMA({
      patientName: 'Paciente Uno',
      originalBedId: 'R2',
    });

    expect(buildRestoreCmaDialog(item)).toMatchObject({
      title: 'Deshacer Egreso CMA',
      message: '¿Restaurar a Paciente Uno a la cama R2?',
    });
  });

  it('builds delete dialog with patient identity and danger variant', () => {
    const item = DataFactory.createMockCMA({
      patientName: 'Paciente CMA',
    });

    expect(buildDeleteCmaDialog(item)).toMatchObject({
      title: 'Eliminar registro CMA',
      message: expect.stringContaining('Paciente CMA'),
      confirmText: 'Eliminar',
      cancelText: 'Cancelar',
      variant: 'danger',
    });
  });

  it('returns cancelled outcome when restore is rejected', async () => {
    const item = DataFactory.createMockCMA({
      originalBedId: 'R1',
      originalData: DataFactory.createMockPatient('R1'),
    });

    const updatePatientMultiple = vi.fn();
    const deleteCMA = vi.fn();
    const result = await executeUndoCmaController(item, {
      confirm: vi.fn().mockResolvedValue(false),
      updatePatientMultiple,
      deleteCMA,
    });

    expect(result).toEqual({
      ok: true,
      value: { outcome: 'cancelled' },
    });
    expect(updatePatientMultiple).not.toHaveBeenCalled();
    expect(deleteCMA).not.toHaveBeenCalled();
  });

  it('restores patient and deletes CMA entry when confirmed', async () => {
    const originalData = DataFactory.createMockPatient('R3', { patientName: 'Restaurado' });
    const item = DataFactory.createMockCMA({
      id: 'cma-1',
      originalBedId: 'R3',
      originalData,
    });

    const updatePatientMultiple = vi.fn();
    const deleteCMA = vi.fn();

    const result = await executeUndoCmaController(item, {
      confirm: vi.fn().mockResolvedValue(true),
      updatePatientMultiple,
      deleteCMA,
    });

    expect(result).toEqual({
      ok: true,
      value: { outcome: 'restored' },
    });
    expect(updatePatientMultiple).toHaveBeenCalledWith('R3', originalData);
    expect(deleteCMA).toHaveBeenCalledWith('cma-1');
  });

  it('uses the atomic CMA undo action when available', async () => {
    const item = DataFactory.createMockCMA({
      id: 'cma-atomic',
      originalBedId: 'R3',
      originalData: DataFactory.createMockPatient('R3', { patientName: 'Restaurado' }),
    });
    const undoCMA = vi.fn();
    const updatePatientMultiple = vi.fn();
    const deleteCMA = vi.fn();

    const result = await executeUndoCmaController(item, {
      confirm: vi.fn().mockResolvedValue(true),
      updatePatientMultiple,
      deleteCMA,
      undoCMA,
    });

    expect(result).toEqual({
      ok: true,
      value: { outcome: 'restored' },
    });
    expect(undoCMA).toHaveBeenCalledWith(item);
    expect(updatePatientMultiple).not.toHaveBeenCalled();
    expect(deleteCMA).not.toHaveBeenCalled();
  });

  it('builds an atomic patch to restore a CMA patient and remove restored movement echoes', () => {
    const originalData = DataFactory.createMockPatient('R3', {
      patientName: 'Restaurado',
      rut: '11.111.111-1',
    });
    const item = DataFactory.createMockCMA({
      id: 'cma-atomic',
      originalBedId: 'R3',
      patientName: 'Restaurado',
      rut: '11.111.111-1',
      originalData,
    });
    const record = DataFactory.createMockDailyRecord('2026-03-20', {
      beds: {
        R3: DataFactory.createMockPatient('R3', { patientName: '' }),
      },
      cma: [item],
      discharges: [
        {
          ...DataFactory.createMockDischarge({
            id: 'discharge-echo',
            bedId: 'R3',
            patientName: 'Restaurado',
            rut: '11.111.111-1',
          }),
        },
      ],
      transfers: [],
    });

    expect(buildUndoCmaPatch(record, item)).toEqual({
      'beds.R3': originalData,
      discharges: [
        expect.objectContaining({
          id: 'discharge-echo',
          deletedAt: expect.any(String),
        }),
      ],
      transfers: [],
      cma: [
        expect.objectContaining({
          id: 'cma-atomic',
          deletedAt: expect.any(String),
        }),
      ],
    });
  });

  it('returns explicit error when confirm dialog rejects', async () => {
    const item = DataFactory.createMockCMA({
      originalBedId: 'R1',
      originalData: DataFactory.createMockPatient('R1'),
    });

    const result = await executeUndoCmaController(item, {
      confirm: vi.fn().mockRejectedValue(new Error('dialog failed')),
      updatePatientMultiple: vi.fn(),
      deleteCMA: vi.fn(),
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('CONFIRMATION_FAILED');
    }
  });

  it('does not delete CMA entry when delete confirmation is rejected', async () => {
    const item = DataFactory.createMockCMA({ id: 'cma-delete-1' });
    const deleteCMA = vi.fn();

    const result = await executeDeleteCmaController(item, {
      confirm: vi.fn().mockResolvedValue(false),
      deleteCMA,
    });

    expect(result).toEqual({
      ok: true,
      value: { outcome: 'cancelled' },
    });
    expect(deleteCMA).not.toHaveBeenCalled();
  });

  it('deletes CMA entry only when delete confirmation is accepted', async () => {
    const item = DataFactory.createMockCMA({ id: 'cma-delete-2' });
    const confirm = vi.fn().mockResolvedValue(true);
    const deleteCMA = vi.fn();

    const result = await executeDeleteCmaController(item, {
      confirm,
      deleteCMA,
    });

    expect(result).toEqual({
      ok: true,
      value: { outcome: 'deleted' },
    });
    expect(confirm).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Eliminar registro CMA',
        confirmText: 'Eliminar',
        variant: 'danger',
      })
    );
    expect(deleteCMA).toHaveBeenCalledWith('cma-delete-2');
  });
});
