import { describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { DataFactory } from '@/tests/factories/DataFactory';
import { usePatientMovementCreationExecutor } from '@/features/census/hooks/usePatientMovementCreationExecutor';

describe('usePatientMovementCreationExecutor', () => {
  it('routes creation errors through notifyCreationError', () => {
    const saveAndUpdate = vi.fn();
    const notifyCreationError = vi.fn();
    const { result } = renderHook(() =>
      usePatientMovementCreationExecutor({
        saveAndUpdate,
        notifyCreationError,
      })
    );

    result.current({
      kind: 'discharge',
      bedId: 'R1',
      resolution: {
        ok: false,
        error: { code: 'SOURCE_BED_EMPTY', message: 'empty' },
      },
    });

    expect(saveAndUpdate).not.toHaveBeenCalled();
    expect(notifyCreationError).toHaveBeenCalledWith('discharge', 'SOURCE_BED_EMPTY', 'R1');
  });

  it('persists updated record and calls onSuccess on successful resolution', async () => {
    const saveAndUpdate = vi.fn().mockResolvedValue(undefined);
    const notifyCreationError = vi.fn();
    const onSuccess = vi.fn();
    const updatedRecord = DataFactory.createMockDailyRecord('2025-01-01');
    const { result } = renderHook(() =>
      usePatientMovementCreationExecutor({
        saveAndUpdate,
        notifyCreationError,
      })
    );

    await result.current({
      kind: 'transfer',
      bedId: 'R2',
      resolution: {
        ok: true,
        value: {
          updatedRecord,
          auditEntry: {
            bedId: 'R2',
            patientName: 'Paciente',
            rut: '11-1',
            receivingCenter: 'Hospital',
          },
        },
      },
      onSuccess,
    });

    expect(notifyCreationError).not.toHaveBeenCalled();
    expect(saveAndUpdate).toHaveBeenCalledWith(updatedRecord);
    expect(onSuccess).toHaveBeenCalledTimes(1);
  });

  it('persists successful creation as one atomic patch when patchRecord is available', async () => {
    const saveAndUpdate = vi.fn();
    const patchRecord = vi.fn().mockResolvedValue(undefined);
    const notifyCreationError = vi.fn();
    const onSuccess = vi.fn();
    const updatedRecord = DataFactory.createMockDailyRecord('2025-01-01');
    updatedRecord.transfers = [DataFactory.createMockTransfer({ id: 'transfer-1' })];
    updatedRecord.beds.R2 = DataFactory.createMockPatient('R2', { patientName: '' });
    const { result } = renderHook(() =>
      usePatientMovementCreationExecutor({
        saveAndUpdate,
        patchRecord,
        notifyCreationError,
      })
    );

    await result.current({
      kind: 'transfer',
      bedId: 'R2',
      resolution: {
        ok: true,
        value: {
          updatedRecord,
          auditEntry: {
            bedId: 'R2',
            patientName: 'Paciente',
            rut: '11-1',
            receivingCenter: 'Hospital',
          },
        },
      },
      onSuccess,
    });

    expect(notifyCreationError).not.toHaveBeenCalled();
    expect(saveAndUpdate).not.toHaveBeenCalled();
    expect(patchRecord).toHaveBeenCalledWith({
      transfers: updatedRecord.transfers,
      'beds.R2': updatedRecord.beds.R2,
    });
    expect(onSuccess).toHaveBeenCalledTimes(1);
  });

  it('does not call onSuccess before patchRecord resolves', async () => {
    const saveAndUpdate = vi.fn();
    let resolvePatch: (() => void) | undefined;
    const patchRecord = vi.fn(
      () =>
        new Promise<void>(resolve => {
          resolvePatch = resolve;
        })
    );
    const notifyCreationError = vi.fn();
    const onSuccess = vi.fn();
    const updatedRecord = DataFactory.createMockDailyRecord('2025-01-01');
    updatedRecord.discharges = [DataFactory.createMockDischarge({ id: 'discharge-1' })];
    updatedRecord.beds.R2 = DataFactory.createMockPatient('R2', { patientName: '' });
    const { result } = renderHook(() =>
      usePatientMovementCreationExecutor({
        saveAndUpdate,
        patchRecord,
        notifyCreationError,
      })
    );

    const execution = result.current({
      kind: 'discharge',
      bedId: 'R2',
      resolution: {
        ok: true,
        value: {
          updatedRecord,
          auditEntries: [],
        },
      },
      onSuccess,
    });

    await Promise.resolve();

    expect(onSuccess).not.toHaveBeenCalled();

    resolvePatch?.();
    await execution;

    expect(onSuccess).toHaveBeenCalledTimes(1);
  });

  it('does not call onSuccess when patchRecord rejects', async () => {
    const saveAndUpdate = vi.fn();
    const patchRecord = vi.fn().mockRejectedValue(new Error('blocked'));
    const notifyCreationError = vi.fn();
    const onSuccess = vi.fn();
    const updatedRecord = DataFactory.createMockDailyRecord('2025-01-01');
    updatedRecord.discharges = [DataFactory.createMockDischarge({ id: 'discharge-1' })];
    updatedRecord.beds.R2 = DataFactory.createMockPatient('R2', { patientName: '' });
    const { result } = renderHook(() =>
      usePatientMovementCreationExecutor({
        saveAndUpdate,
        patchRecord,
        notifyCreationError,
      })
    );

    await expect(
      result.current({
        kind: 'discharge',
        bedId: 'R2',
        resolution: {
          ok: true,
          value: {
            updatedRecord,
            auditEntries: [],
          },
        },
        onSuccess,
      })
    ).rejects.toThrow('blocked');

    expect(onSuccess).not.toHaveBeenCalled();
  });

  it('does not call onSuccess before saveAndUpdate resolves when patchRecord is unavailable', async () => {
    let resolveSave: (() => void) | undefined;
    const saveAndUpdate = vi.fn(
      () =>
        new Promise<void>(resolve => {
          resolveSave = resolve;
        })
    );
    const notifyCreationError = vi.fn();
    const onSuccess = vi.fn();
    const updatedRecord = DataFactory.createMockDailyRecord('2025-01-01');
    const { result } = renderHook(() =>
      usePatientMovementCreationExecutor({
        saveAndUpdate,
        notifyCreationError,
      })
    );

    const execution = result.current({
      kind: 'transfer',
      bedId: 'R2',
      resolution: {
        ok: true,
        value: {
          updatedRecord,
          auditEntry: {
            bedId: 'R2',
            patientName: 'Paciente',
            rut: '11-1',
            receivingCenter: 'Hospital',
          },
        },
      },
      onSuccess,
    });

    await Promise.resolve();

    expect(onSuccess).not.toHaveBeenCalled();

    resolveSave?.();
    await execution;

    expect(onSuccess).toHaveBeenCalledTimes(1);
  });
});
