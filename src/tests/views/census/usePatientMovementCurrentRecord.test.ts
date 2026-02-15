import { describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { DataFactory } from '@/tests/factories/DataFactory';
import { usePatientMovementCurrentRecord } from '@/features/census/hooks/usePatientMovementCurrentRecord';

describe('usePatientMovementCurrentRecord', () => {
  it('returns undefined and does not execute operation when current record is null', () => {
    const operation = vi.fn();
    const recordRef = { current: null };
    const { result } = renderHook(() => usePatientMovementCurrentRecord({ recordRef }));

    const output = result.current(operation);

    expect(output).toBeUndefined();
    expect(operation).not.toHaveBeenCalled();
  });

  it('executes operation with current record and returns operation result', () => {
    const record = DataFactory.createMockDailyRecord('2025-01-01');
    const recordRef = { current: record };
    const { result } = renderHook(() => usePatientMovementCurrentRecord({ recordRef }));

    const output = result.current(currentRecord => currentRecord.date);

    expect(output).toBe('2025-01-01');
  });
});
