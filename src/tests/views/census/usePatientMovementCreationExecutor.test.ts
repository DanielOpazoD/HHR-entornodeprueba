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

  it('persists updated record and calls onSuccess on successful resolution', () => {
    const saveAndUpdate = vi.fn();
    const notifyCreationError = vi.fn();
    const onSuccess = vi.fn();
    const updatedRecord = DataFactory.createMockDailyRecord('2025-01-01');
    const { result } = renderHook(() =>
      usePatientMovementCreationExecutor({
        saveAndUpdate,
        notifyCreationError,
      })
    );

    result.current({
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
});
