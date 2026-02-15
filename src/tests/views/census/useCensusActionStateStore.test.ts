import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { DataFactory } from '@/tests/factories/DataFactory';
import { useCensusActionStateStore } from '@/features/census/hooks/useCensusActionStateStore';

describe('useCensusActionStateStore', () => {
  it('exposes default action/discharge/transfer state', () => {
    const { result } = renderHook(() => useCensusActionStateStore());

    expect(result.current.actionState).toEqual({
      type: null,
      sourceBedId: null,
      targetBedId: null,
    });
    expect(result.current.dischargeState).toMatchObject({
      bedId: null,
      isOpen: false,
    });
    expect(result.current.transferState).toMatchObject({
      bedId: null,
      isOpen: false,
    });
  });

  it('maps edit handlers to discharge and transfer edit state', () => {
    const { result } = renderHook(() => useCensusActionStateStore());
    const discharge = DataFactory.createMockDischarge({
      id: 'd-1',
      status: 'Vivo',
      dischargeType: 'Voluntaria',
      time: '11:00',
    });
    const transfer = DataFactory.createMockTransfer({
      id: 't-1',
      evacuationMethod: 'Aerocardal',
      receivingCenter: 'Hospital Salvador',
      time: '12:00',
    });

    act(() => {
      result.current.handleEditDischarge(discharge);
      result.current.handleEditTransfer(transfer);
    });

    expect(result.current.dischargeState).toMatchObject({
      recordId: 'd-1',
      isOpen: true,
      status: 'Vivo',
      type: 'Voluntaria',
      time: '11:00',
    });
    expect(result.current.transferState).toMatchObject({
      recordId: 't-1',
      isOpen: true,
      evacuationMethod: 'Aerocardal',
      receivingCenter: 'Hospital Salvador',
      time: '12:00',
    });
  });
});
