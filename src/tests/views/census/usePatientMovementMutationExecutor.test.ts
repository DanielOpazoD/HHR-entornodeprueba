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

  it('persists mutated record when current record exists', async () => {
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

    await result.current(() => updatedRecord);

    expect(saveAndUpdate).toHaveBeenCalledWith(updatedRecord);
  });

  it('returns a persistence promise instead of fire-and-forget', async () => {
    const deferred = Promise.withResolvers<void>();
    const saveAndUpdate = vi.fn().mockReturnValue(deferred.promise);
    const record = DataFactory.createMockDailyRecord('2025-01-01');
    const recordRef = { current: record };
    const updatedRecord = {
      ...record,
      transfers: [...record.transfers, DataFactory.createMockTransfer({ id: 't-1' })],
    };
    const { result } = renderHook(() =>
      usePatientMovementMutationExecutor({
        recordRef,
        saveAndUpdate,
      })
    );

    let settled = false;
    const execution = result.current(() => updatedRecord);
    void execution.then(() => {
      settled = true;
    });

    await Promise.resolve();
    expect(settled).toBe(false);

    deferred.resolve();
    await execution;
    expect(settled).toBe(true);
  });

  it('persists movement mutations through an atomic movement patch when patchRecord is available', async () => {
    const saveAndUpdate = vi.fn();
    const patchRecord = vi.fn().mockResolvedValue(undefined);
    const record = DataFactory.createMockDailyRecord('2025-01-01', {
      discharges: [
        DataFactory.createMockDischarge({ id: 'd-1', status: 'Vivo', time: '08:00' }),
        DataFactory.createMockDischarge({ id: 'd-2', status: 'Vivo', time: '09:00' }),
      ],
      transfers: [DataFactory.createMockTransfer({ id: 't-untouched' })],
    });
    const recordRef = { current: record };
    const { result } = renderHook(() =>
      usePatientMovementMutationExecutor({
        recordRef,
        saveAndUpdate,
        patchRecord,
        movementKey: 'discharges',
      })
    );

    await result.current(currentRecord => ({
      ...currentRecord,
      discharges: currentRecord.discharges.map(discharge =>
        discharge.id === 'd-2' ? { ...discharge, time: '10:30' } : discharge
      ),
    }));

    expect(saveAndUpdate).not.toHaveBeenCalled();
    expect(patchRecord).toHaveBeenCalledWith({
      discharges: [
        expect.objectContaining({ id: 'd-1', time: '08:00' }),
        expect.objectContaining({ id: 'd-2', time: '10:30' }),
      ],
    });
    expect(patchRecord.mock.calls[0]?.[0]).not.toHaveProperty('transfers');
    expect(patchRecord.mock.calls[0]?.[0]).not.toHaveProperty('cma');
  });
});
