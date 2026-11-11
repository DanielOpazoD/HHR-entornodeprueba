import { describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import { usePatientMovementMutationByIdExecutor } from '@/hooks/usePatientMovementMutationByIdExecutor';

describe('usePatientMovementMutationByIdExecutor', () => {
  it('adapts a mutation-by-id into the generic movement mutation executor', () => {
    const executeMovementMutation = vi.fn();
    const record = { date: '2026-04-12' } as DailyRecord;
    const mutation = vi.fn((_record: DailyRecord, id: string) => ({ ...record, id }));

    const { result } = renderHook(() =>
      usePatientMovementMutationByIdExecutor({ executeMovementMutation })
    );

    act(() => {
      result.current(mutation, 'movement-1');
    });

    expect(executeMovementMutation).toHaveBeenCalledTimes(1);
    const adaptedMutation = executeMovementMutation.mock.calls[0][0] as (
      input: DailyRecord
    ) => DailyRecord;
    expect(adaptedMutation(record)).toEqual({ ...record, id: 'movement-1' });
    expect(mutation).toHaveBeenCalledWith(record, 'movement-1');
  });
});
