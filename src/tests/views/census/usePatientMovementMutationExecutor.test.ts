import { describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { DataFactory } from '@/tests/factories/DataFactory';
import { usePatientMovementMutationExecutor } from '@/features/census/hooks/usePatientMovementMutationExecutor';

describe('usePatientMovementMutationExecutor', () => {
  it('does not persist when there is no current record', () => {
    const saveAndUpdate = vi.fn();
    const recordRef = { current: null };
    const { result } = renderHook(() =>
      usePatientMovementMutationExecutor({
        recordRef,
        saveAndUpdate,
      })
    );

    result.current(record => record);

    expect(saveAndUpdate).not.toHaveBeenCalled();
  });

  it('persists mutated record when current record exists', () => {
    const saveAndUpdate = vi.fn();
    const record = DataFactory.createMockDailyRecord('2025-01-01');
    const recordRef = { current: record };
    const updatedRecord = {
      ...record,
      discharges: [...record.discharges, DataFactory.createMockDischarge({ id: 'd-1' })],
    };
    const { result } = renderHook(() =>
      usePatientMovementMutationExecutor({
        recordRef,
        saveAndUpdate,
      })
    );

    result.current(() => updatedRecord);

    expect(saveAndUpdate).toHaveBeenCalledWith(updatedRecord);
  });
});
