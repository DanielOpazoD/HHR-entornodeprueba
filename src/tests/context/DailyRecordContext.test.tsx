import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import {
  DailyRecordProvider,
  useDailyRecordData,
  useDailyRecordBeds,
  useDailyRecordMeta,
  useDailyRecordMovements,
  useDailyRecordOverrides,
  useDailyRecordStability,
  useDailyRecordSync,
  useDailyRecordStatus,
  useDailyRecordStaff,
  useDailyRecordBedActions,
  useDailyRecordDayActions,
  useDailyRecordHandoffActions,
  useDailyRecordMovementActions,
  useDailyRecordStaffActions,
} from '@/context/DailyRecordContext';
import { DailyRecordContextType } from '@/context/dailyRecordContextContracts';

describe('DailyRecordContext', () => {
  const mockValue = {
    record: {
      beds: { bed1: { id: 'p1', name: 'Patient 1' } },
      discharges: [],
      transfers: [],
      cma: [],
      nursesDayShift: ['Nurse 1'],
      nursesNightShift: [],
      tensDayShift: [],
      tensNightShift: [],
      activeExtraBeds: [],
    },
    syncStatus: 'synced',
    lastSyncTime: new Date('2026-02-20T00:00:00.000Z'),
    inventory: {
      occupiedCount: 1,
      blockedCount: 0,
      availableCount: 23,
      occupancyRate: 4,
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
    refresh: vi.fn(),
    createDay: vi.fn(),
    resetDay: vi.fn(),
    updatePatient: vi.fn(),
    updatePatientMultiple: vi.fn(),
    updateClinicalCrib: vi.fn(),
    updateClinicalCribMultiple: vi.fn(),
    clearPatient: vi.fn(),
    clearAllBeds: vi.fn(),
    moveOrCopyPatient: vi.fn(),
    toggleBlockBed: vi.fn(),
    updateBlockedReason: vi.fn(),
    toggleExtraBed: vi.fn(),
    toggleBedType: vi.fn(),
    copyPatientToDate: vi.fn(),
    addDischarge: vi.fn(),
    updateDischarge: vi.fn(),
    deleteDischarge: vi.fn(),
    undoDischarge: vi.fn(),
    convertDischargeToCma: vi.fn(),
    addTransfer: vi.fn(),
    updateTransfer: vi.fn(),
    deleteTransfer: vi.fn(),
    undoTransfer: vi.fn(),
    addCMA: vi.fn(),
    deleteCMA: vi.fn(),
    updateCMA: vi.fn(),
    undoCMA: vi.fn(),
    convertCmaToHomeDischarge: vi.fn(),
    updateShiftStaff: vi.fn(),
    updateDetailedStaffing: vi.fn(),
    updateHandoffChecklist: vi.fn(),
    updateHandoffNovedades: vi.fn(),
    updateHandoffReceives: vi.fn(),
  } as unknown as DailyRecordContextType;

  const TestComponent = ({ hook }: { hook: () => unknown }) => {
    const data = hook();
    return <div data-testid="hook-data">{JSON.stringify(data)}</div>;
  };

  const MovementConversionActionsProbe = () => {
    const actions = useDailyRecordMovementActions();
    return (
      <div data-testid="movement-conversion-actions">
        {typeof actions.convertDischargeToCma}:{typeof actions.convertCmaToHomeDischarge}
      </div>
    );
  };

  it('should provide data via useDailyRecordData', () => {
    render(
      <DailyRecordProvider value={mockValue}>
        <TestComponent hook={useDailyRecordData} />
      </DailyRecordProvider>
    );
    expect(screen.getByTestId('hook-data').textContent).toContain('synced');
  });

  it('should provide beds via useDailyRecordBeds', () => {
    render(
      <DailyRecordProvider value={mockValue}>
        <TestComponent hook={useDailyRecordBeds} />
      </DailyRecordProvider>
    );
    expect(screen.getByTestId('hook-data').textContent).toContain('Patient 1');
  });

  it('should handle missing record in staffValue', () => {
    const valueWithoutRecord: DailyRecordContextType = { ...mockValue, record: null };
    render(
      <DailyRecordProvider value={valueWithoutRecord}>
        <TestComponent hook={useDailyRecordStaff} />
      </DailyRecordProvider>
    );
    expect(screen.getByTestId('hook-data').textContent).toBe('null');
  });

  it('should handle missing record in movementsValue', () => {
    const valueWithoutRecord: DailyRecordContextType = { ...mockValue, record: null };
    render(
      <DailyRecordProvider value={valueWithoutRecord}>
        <TestComponent hook={useDailyRecordMovements} />
      </DailyRecordProvider>
    );
    expect(screen.getByTestId('hook-data').textContent).toBe('null');
  });

  it('exposes only active movements through useDailyRecordMovements', () => {
    const valueWithDeletedMovements = {
      ...mockValue,
      record: {
        ...mockValue.record,
        discharges: [
          { id: 'd-active', patientName: 'Alta activa' },
          { id: 'd-deleted', patientName: 'Alta borrada', deletedAt: '2026-05-12T10:00:00.000Z' },
        ],
        transfers: [
          { id: 't-active', patientName: 'Traslado activo' },
          {
            id: 't-deleted',
            patientName: 'Traslado borrado',
            deletedAt: '2026-05-12T10:00:00.000Z',
          },
        ],
        cma: [
          { id: 'cma-active', patientName: 'CMA activa' },
          { id: 'cma-deleted', patientName: 'CMA borrada', deletedAt: '2026-05-12T10:00:00.000Z' },
        ],
      },
    } as unknown as DailyRecordContextType;

    render(
      <DailyRecordProvider value={valueWithDeletedMovements}>
        <TestComponent hook={useDailyRecordMovements} />
      </DailyRecordProvider>
    );

    const data = JSON.parse(screen.getByTestId('hook-data').textContent || '{}');
    expect(data.discharges.map((item: { id: string }) => item.id)).toEqual(['d-active']);
    expect(data.transfers.map((item: { id: string }) => item.id)).toEqual(['t-active']);
    expect(data.cma.map((item: { id: string }) => item.id)).toEqual(['cma-active']);
  });

  it('should provide sync status via useDailyRecordSync', () => {
    render(
      <DailyRecordProvider value={mockValue}>
        <TestComponent hook={useDailyRecordSync} />
      </DailyRecordProvider>
    );
    expect(screen.getByTestId('hook-data').textContent).toContain('synced');
  });

  it('should expose derived sync flags via useDailyRecordStatus', () => {
    const savingValue = {
      ...mockValue,
      syncStatus: 'saving',
    } as DailyRecordContextType;

    render(
      <DailyRecordProvider value={savingValue}>
        <TestComponent hook={useDailyRecordStatus} />
      </DailyRecordProvider>
    );
    expect(screen.getByTestId('hook-data').textContent).toContain('"isSaving":true');
    expect(screen.getByTestId('hook-data').textContent).toContain('"hasError":false');
  });

  it('should provide default sync status when value is null', () => {
    render(
      <DailyRecordProvider value={null as unknown as DailyRecordContextType}>
        <TestComponent hook={useDailyRecordSync} />
      </DailyRecordProvider>
    );
    expect(screen.getByTestId('hook-data').textContent).toContain('idle');
  });

  it('should provide scoped action hooks', () => {
    const dayRender = render(
      <DailyRecordProvider value={mockValue}>
        <TestComponent hook={useDailyRecordDayActions} />
      </DailyRecordProvider>
    );
    expect(dayRender.getByTestId('hook-data')).toBeInTheDocument();
    dayRender.unmount();

    const bedRender = render(
      <DailyRecordProvider value={mockValue}>
        <TestComponent hook={useDailyRecordBedActions} />
      </DailyRecordProvider>
    );
    expect(bedRender.getByTestId('hook-data')).toBeInTheDocument();
    bedRender.unmount();

    const movementRender = render(
      <DailyRecordProvider value={mockValue}>
        <TestComponent hook={useDailyRecordMovementActions} />
      </DailyRecordProvider>
    );
    expect(movementRender.getByTestId('hook-data')).toBeInTheDocument();
    movementRender.unmount();

    const staffRender = render(
      <DailyRecordProvider value={mockValue}>
        <TestComponent hook={useDailyRecordStaffActions} />
      </DailyRecordProvider>
    );
    expect(staffRender.getByTestId('hook-data')).toBeInTheDocument();
    staffRender.unmount();

    const handoffRender = render(
      <DailyRecordProvider value={mockValue}>
        <TestComponent hook={useDailyRecordHandoffActions} />
      </DailyRecordProvider>
    );
    expect(handoffRender.getByTestId('hook-data')).toBeInTheDocument();
    handoffRender.unmount();
  });

  it('exposes movement conversion actions through the fragmented actions context', () => {
    render(
      <DailyRecordProvider value={mockValue}>
        <MovementConversionActionsProbe />
      </DailyRecordProvider>
    );

    expect(screen.getByTestId('movement-conversion-actions')).toHaveTextContent(
      'function:function'
    );
  });

  it('preserves referential stability for status and empty overrides across unrelated provider updates', () => {
    const statusRefs: ReturnType<typeof useDailyRecordStatus>[] = [];
    const overrideRefs: ReturnType<typeof useDailyRecordOverrides>[] = [];

    const StabilityProbe = () => {
      statusRefs.push(useDailyRecordStatus());
      overrideRefs.push(useDailyRecordOverrides());
      return null;
    };

    const { rerender } = render(
      <DailyRecordProvider value={mockValue}>
        <StabilityProbe />
      </DailyRecordProvider>
    );

    rerender(
      <DailyRecordProvider value={{ ...mockValue }}>
        <StabilityProbe />
      </DailyRecordProvider>
    );

    expect(statusRefs).toHaveLength(2);
    expect(statusRefs[0]).toBe(statusRefs[1]);
    expect(overrideRefs).toHaveLength(2);
    expect(overrideRefs[0]).toBe(overrideRefs[1]);
  });

  it('isolates beds, staff, and stability consumers from syncStatus updates', () => {
    let bedsRenders = 0;
    let staffRenders = 0;
    let stabilityRenders = 0;

    const BedsProbe = React.memo(function BedsProbe() {
      bedsRenders += 1;
      useDailyRecordBeds();
      return null;
    });
    const StaffProbe = React.memo(function StaffProbe() {
      staffRenders += 1;
      useDailyRecordStaff();
      return null;
    });
    const StabilityProbe = React.memo(function StabilityProbe() {
      stabilityRenders += 1;
      useDailyRecordStability();
      return null;
    });

    const stableChildren = (
      <>
        <BedsProbe />
        <StaffProbe />
        <StabilityProbe />
      </>
    );

    const { rerender } = render(
      <DailyRecordProvider value={mockValue}>{stableChildren}</DailyRecordProvider>
    );

    rerender(
      <DailyRecordProvider value={{ ...mockValue, syncStatus: 'saving' }}>
        {stableChildren}
      </DailyRecordProvider>
    );

    expect(bedsRenders).toBe(1);
    expect(staffRenders).toBe(1);
    expect(stabilityRenders).toBe(1);
  });

  it('isolates useDailyRecordMeta consumers from bed edits, sync ticks, staff and movement updates', () => {
    let metaRenders = 0;
    let bedsAndMetaRenders = 0;
    let lastMeta: ReturnType<typeof useDailyRecordMeta> | undefined;

    const MetaProbe = React.memo(function MetaProbe() {
      metaRenders += 1;
      lastMeta = useDailyRecordMeta();
      return null;
    });
    const BedsAndMetaProbe = React.memo(function BedsAndMetaProbe() {
      bedsAndMetaRenders += 1;
      useDailyRecordBeds();
      useDailyRecordMeta();
      return null;
    });

    const stableChildren = (
      <>
        <MetaProbe />
        <BedsAndMetaProbe />
      </>
    );

    const baseRecord = {
      ...mockValue.record!,
      date: '2026-10-10',
      activeExtraBeds: [],
    };
    const baseValue = { ...mockValue, record: baseRecord } as DailyRecordContextType;

    const { rerender } = render(
      <DailyRecordProvider value={baseValue}>{stableChildren}</DailyRecordProvider>
    );
    expect(metaRenders).toBe(1);
    expect(bedsAndMetaRenders).toBe(1);
    expect(lastMeta).toEqual({
      date: '2026-10-10',
      rayenCoverageCompletedAt: '',
      activeExtraBeds: [],
    });

    // Unrelated sync tick, staff edit, and movement edit must not re-render either narrow consumer.
    rerender(
      <DailyRecordProvider
        value={{
          ...baseValue,
          syncStatus: 'saving',
          lastSyncTime: new Date('2026-10-10T01:00:00.000Z'),
          record: {
            ...baseRecord,
            nursesDayShift: ['Nurse Updated'],
            discharges: [
              {
                id: 'd-1',
                patientName: 'Alta',
              } as unknown as DailyRecordContextType['record'] extends {
                discharges: (infer D)[];
              }
                ? D
                : never,
            ],
            activeExtraBeds: [],
          },
        }}
      >
        {stableChildren}
      </DailyRecordProvider>
    );
    expect(metaRenders).toBe(1);
    expect(bedsAndMetaRenders).toBe(1);

    // Bed edit must re-render the beds consumer, but NOT the meta-only consumer.
    rerender(
      <DailyRecordProvider
        value={{
          ...baseValue,
          record: {
            ...baseRecord,
            beds: { ...baseRecord.beds },
            activeExtraBeds: [],
          },
        }}
      >
        {stableChildren}
      </DailyRecordProvider>
    );
    expect(metaRenders).toBe(1);
    expect(bedsAndMetaRenders).toBe(2);

    // Completing Rayen coverage updates the meta consumer exactly once.
    rerender(
      <DailyRecordProvider
        value={{
          ...baseValue,
          record: {
            ...baseRecord,
            beds: { ...baseRecord.beds },
            rayenSync: {
              at: '2026-10-10T10:00:00Z',
              by: 'Test',
              status: 'complete',
              coverage: {
                total: 1,
                completed: 1,
                errors: 0,
                sourceErrors: 0,
                completedAt: '2026-10-10T10:00:00Z',
              },
            },
          },
        }}
      >
        {stableChildren}
      </DailyRecordProvider>
    );
    expect(metaRenders).toBe(2);
    expect(lastMeta?.rayenCoverageCompletedAt).toBe('2026-10-10T10:00:00Z');
  });

  it('should throw error when hooks are used outside provider', () => {
    const hooks = [
      { name: 'useDailyRecordData', hook: useDailyRecordData },
      { name: 'useDailyRecordBeds', hook: useDailyRecordBeds },
      { name: 'useDailyRecordMeta', hook: useDailyRecordMeta },
      { name: 'useDailyRecordMovements', hook: useDailyRecordMovements },
      { name: 'useDailyRecordSync', hook: useDailyRecordSync },
      { name: 'useDailyRecordStaff', hook: useDailyRecordStaff },
      { name: 'useDailyRecordDayActions', hook: useDailyRecordDayActions },
      { name: 'useDailyRecordBedActions', hook: useDailyRecordBedActions },
      { name: 'useDailyRecordMovementActions', hook: useDailyRecordMovementActions },
      { name: 'useDailyRecordStaffActions', hook: useDailyRecordStaffActions },
      { name: 'useDailyRecordHandoffActions', hook: useDailyRecordHandoffActions },
    ];

    // Silence console.error for expected errors
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    hooks.forEach(({ name, hook }) => {
      expect(() => render(<TestComponent hook={hook} />)).toThrow(
        `${name} must be used within a DailyRecordProvider`
      );
    });

    consoleSpy.mockRestore();
  });
});
