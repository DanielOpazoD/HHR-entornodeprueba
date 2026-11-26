import React from 'react';
import { render, renderHook, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DailyRecordProvider } from '@/context/DailyRecordContext';
import {
  CensusMovementActionsProvider,
  useCensusMovementActions,
} from '@/features/census/context/CensusMovementActionsContext';
import { useCensusStaffActions } from '@/features/census/hooks/useCensusStaffActions';
import { UIProvider } from '@/context/UIContext';
import { DataFactory } from '@/tests/factories/DataFactory';
import { createMockDailyRecordContext } from '@/tests/integration/setup';

describe('CensusMovementActionsContext and useCensusStaffActions', () => {
  it('throws when useCensusMovementActions is used outside CensusMovementActionsProvider', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => renderHook(() => useCensusMovementActions())).toThrow(
      'useCensusMovementActions must be used within a CensusMovementActionsProvider'
    );
    consoleSpy.mockRestore();
  });

  it('exposes movement and conversion actions and keeps reference stability across bed edits', () => {
    const refs: ReturnType<typeof useCensusMovementActions>[] = [];
    const Probe = () => {
      const actions = useCensusMovementActions();
      refs.push(actions);
      return (
        <div data-testid="movement-actions-types">
          {typeof actions.addDischarge}:{typeof actions.convertDischargeToCma}:
          {typeof actions.convertCmaToHomeDischarge}
        </div>
      );
    };

    const recordA = DataFactory.createMockDailyRecord('2026-11-26');
    const contextValueA = createMockDailyRecordContext(recordA);
    const { rerender } = render(
      <UIProvider>
        <DailyRecordProvider value={contextValueA}>
          <CensusMovementActionsProvider>
            <Probe />
          </CensusMovementActionsProvider>
        </DailyRecordProvider>
      </UIProvider>
    );

    expect(screen.getByTestId('movement-actions-types')).toHaveTextContent(
      'function:function:function'
    );

    const recordB = DataFactory.createMockDailyRecord('2026-11-26', {
      handoffNovedadesDayShift: 'Updated',
    });
    rerender(
      <UIProvider>
        <DailyRecordProvider value={{ ...contextValueA, record: recordB }}>
          <CensusMovementActionsProvider>
            <Probe />
          </CensusMovementActionsProvider>
        </DailyRecordProvider>
      </UIProvider>
    );

    expect(refs.length).toBeGreaterThanOrEqual(2);
    expect(refs[0]).toBe(refs[refs.length - 1]);
  });

  it('exposes shift staffing actions through useCensusStaffActions', () => {
    const record = DataFactory.createMockDailyRecord('2026-11-26');
    const contextValue = createMockDailyRecordContext(record);
    const wrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => (
      <DailyRecordProvider value={contextValue}>{children}</DailyRecordProvider>
    );

    const { result } = renderHook(() => useCensusStaffActions(), { wrapper });
    expect(typeof result.current.updateShiftStaff).toBe('function');
    expect(typeof result.current.updateDetailedStaffing).toBe('function');
  });
});
