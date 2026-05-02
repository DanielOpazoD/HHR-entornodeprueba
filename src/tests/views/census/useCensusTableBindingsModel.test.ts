import React from 'react';
import { renderHook } from '@testing-library/react';
import { act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DailyRecordProvider } from '@/context/DailyRecordContext';
import type { DailyRecordContextType } from '@/context/dailyRecordContextContracts';
import { useCensusTableBindingsModel } from '@/features/census/hooks/useCensusTableBindingsModel';
import { useCensusTableViewModel } from '@/features/census/hooks/useCensusTableViewModel';
import { useClinicalDocumentPresenceByBed } from '@/features/census/hooks/useClinicalDocumentPresenceByBed';
import { buildCensusTableLayoutBindings } from '@/features/census/controllers/censusTableLayoutController';

vi.mock('@/features/census/hooks/useCensusTableViewModel', () => ({
  useCensusTableViewModel: vi.fn(),
}));

vi.mock('@/features/census/hooks/useClinicalDocumentPresenceByBed', () => ({
  useClinicalDocumentPresenceByBed: vi.fn(),
}));

vi.mock('@/features/census/controllers/censusTableLayoutController', () => ({
  buildCensusTableLayoutBindings: vi.fn(),
}));

const mockUseAuth = vi.fn(() => ({ remoteSyncStatus: 'ready' }));

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => mockUseAuth(),
}));

const asHookValue = <T>(value: Partial<T>): T => value as T;

const createDailyRecordContextValue = (
  discharges: Array<{ rut?: string }> = []
): DailyRecordContextType =>
  ({
    record: {
      date: '2026-03-10',
      lastUpdated: '2026-03-10T12:00:00.000Z',
      beds: {},
      discharges,
      transfers: [],
      cma: [],
      nursesDayShift: [],
      nursesNightShift: [],
      tensDayShift: [],
      tensNightShift: [],
      activeExtraBeds: [],
      handoffDayChecklist: {},
      handoffNightChecklist: {},
      handoffNovedadesDayShift: '',
      handoffNovedadesNightShift: '',
      medicalHandoffNovedades: '',
      medicalHandoffDoctor: '',
    },
    syncStatus: 'idle',
    lastSyncTime: null,
    bootstrapPhase: 'record_ready',
    inventory: {
      occupiedCount: 0,
      blockedCount: 0,
      availableCount: 0,
      occupancyRate: 0,
      occupiedBeds: [],
      freeBeds: [],
      blockedBeds: [],
      isFull: false,
    },
    stabilityRules: {
      isDateLocked: false,
      isDayShiftLocked: false,
      isNightShiftLocked: false,
      canEditField: () => true,
      canPerformActions: true,
    },
  }) as unknown as DailyRecordContextType;

const createDailyRecordWrapper = (contextValue = createDailyRecordContextValue()) => {
  const DailyRecordWrapper = ({ children }: { children: React.ReactNode }) =>
    // DailyRecordProvider types children as required on its props, so it cannot be passed as the
    // third React.createElement argument without tripping the TypeScript overload. Passing it as a
    // prop is the only typesafe path for this .test.ts file (no JSX).
    // eslint-disable-next-line react/no-children-prop
    React.createElement(DailyRecordProvider, { value: contextValue, children });
  DailyRecordWrapper.displayName = 'DailyRecordWrapper';
  return DailyRecordWrapper;
};

describe('useCensusTableBindingsModel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
    mockUseAuth.mockReturnValue({ remoteSyncStatus: 'ready' });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns not-ready when the base table model has no beds payload yet', () => {
    vi.mocked(useCensusTableViewModel).mockReturnValue(
      asHookValue<ReturnType<typeof useCensusTableViewModel>>({
        beds: null,
        unifiedRows: [],
        role: 'viewer',
      })
    );
    vi.mocked(useClinicalDocumentPresenceByBed).mockReturnValue({
      byBedId: {},
      infoByBedId: {},
    });

    const { result } = renderHook(
      () =>
        useCensusTableBindingsModel({
          currentDateString: '2026-03-10',
        }),
      { wrapper: createDailyRecordWrapper() }
    );

    expect(result.current.isReady).toBe(false);
    expect(result.current.bindings).toBeNull();
    expect(buildCensusTableLayoutBindings).not.toHaveBeenCalled();
  });

  it('defers the remote clinical document presence lookup until after the table can paint', async () => {
    vi.useFakeTimers();
    const layoutBindings = {
      headerProps: { readOnly: false },
      bodyProps: { currentDateString: '2026-03-10' },
      tableStyle: { width: '1200px', minWidth: '100%' },
    };

    vi.mocked(useCensusTableViewModel).mockReturnValue(
      asHookValue<ReturnType<typeof useCensusTableViewModel>>({
        beds: {},
        columns: {} as never,
        isEditMode: false,
        canDeleteRecord: true,
        resetDayDeniedMessage: '',
        unifiedRows: [],
        bedTypes: {},
        totalWidth: 1200,
        handleClearAll: vi.fn(),
        diagnosisMode: 'free',
        toggleDiagnosisMode: vi.fn(),
        handleRowAction: vi.fn(),
        activateEmptyBed: vi.fn(),
        handleColumnResize: vi.fn(),
        role: 'doctor_urgency',
      })
    );
    vi.mocked(useClinicalDocumentPresenceByBed).mockReturnValue({
      byBedId: { R1: true },
      infoByBedId: { R1: { present: true, totalCount: 1, draftCount: 0 } },
    });
    vi.mocked(buildCensusTableLayoutBindings).mockReturnValue(layoutBindings as never);

    const { result, rerender } = renderHook(
      () =>
        useCensusTableBindingsModel({
          currentDateString: '2026-03-10',
        }),
      {
        wrapper: createDailyRecordWrapper(createDailyRecordContextValue([{ rut: '11.111.111-1' }])),
      }
    );

    expect(useClinicalDocumentPresenceByBed).toHaveBeenLastCalledWith({
      unifiedRows: [],
      currentDateString: '2026-03-10',
      enabled: false,
    });
    expect(result.current.isReady).toBe(true);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    rerender();

    expect(useClinicalDocumentPresenceByBed).toHaveBeenLastCalledWith({
      unifiedRows: [],
      currentDateString: '2026-03-10',
      enabled: true,
    });
    expect(buildCensusTableLayoutBindings).toHaveBeenCalledWith(
      expect.objectContaining({
        currentDateString: '2026-03-10',
        clinicalDocumentPresenceByBedId: { R1: true },
        dischargedRuts: new Set(['11.111.111-1']),
        totalWidth: 1200,
      })
    );
    expect(result.current.isReady).toBe(true);
    expect(result.current.bindings).toBe(layoutBindings);
    expect(result.current.clinicalDocumentInfoByBedId).toEqual({
      R1: { present: true, totalCount: 1, draftCount: 0 },
    });
  });

  it('disables remote clinical document presence lookup outside ready sync', () => {
    mockUseAuth.mockReturnValue({ remoteSyncStatus: 'local_only' });
    vi.mocked(useCensusTableViewModel).mockReturnValue(
      asHookValue<ReturnType<typeof useCensusTableViewModel>>({
        beds: {},
        columns: {} as never,
        isEditMode: false,
        canDeleteRecord: true,
        resetDayDeniedMessage: '',
        unifiedRows: [],
        bedTypes: {},
        totalWidth: 1200,
        handleClearAll: vi.fn(),
        diagnosisMode: 'free',
        toggleDiagnosisMode: vi.fn(),
        handleRowAction: vi.fn(),
        activateEmptyBed: vi.fn(),
        handleColumnResize: vi.fn(),
        role: 'doctor_urgency',
      })
    );
    vi.mocked(useClinicalDocumentPresenceByBed).mockReturnValue({
      byBedId: {},
      infoByBedId: {},
    });
    vi.mocked(buildCensusTableLayoutBindings).mockReturnValue({
      headerProps: { readOnly: false },
      bodyProps: { currentDateString: '2026-03-10' },
      tableStyle: { width: '1200px', minWidth: '100%' },
    } as never);

    renderHook(
      () =>
        useCensusTableBindingsModel({
          currentDateString: '2026-03-10',
        }),
      { wrapper: createDailyRecordWrapper() }
    );

    expect(useClinicalDocumentPresenceByBed).toHaveBeenCalledWith({
      unifiedRows: [],
      currentDateString: '2026-03-10',
      enabled: false,
    });
  });
});
