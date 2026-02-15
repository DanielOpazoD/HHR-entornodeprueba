import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import {
  DailyRecordProvider,
  useDailyRecordData,
  useDailyRecordBeds,
  useDailyRecordMovements,
  useDailyRecordSync,
  useDailyRecordStatus,
  useDailyRecordStaff,
  useDailyRecordActions,
} from '@/context/DailyRecordContext';
import { DailyRecordContextType } from '@/hooks/useDailyRecordTypes';

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
    lastSyncTime: new Date(),
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
  } as unknown as DailyRecordContextType;

  const TestComponent = ({ hook }: { hook: () => unknown }) => {
    const data = hook();
    return <div data-testid="hook-data">{JSON.stringify(data)}</div>;
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

  it('should provide actions via useDailyRecordActions', () => {
    render(
      <DailyRecordProvider value={mockValue}>
        <TestComponent hook={useDailyRecordActions} />
      </DailyRecordProvider>
    );
    // Should contain refresh function (serialized as empty object or similar in JSON.stringify if mock)
    expect(screen.getByTestId('hook-data')).toBeInTheDocument();
  });

  it('should throw error when hooks are used outside provider', () => {
    const hooks = [
      { name: 'useDailyRecordData', hook: useDailyRecordData },
      { name: 'useDailyRecordBeds', hook: useDailyRecordBeds },
      { name: 'useDailyRecordMovements', hook: useDailyRecordMovements },
      { name: 'useDailyRecordSync', hook: useDailyRecordSync },
      { name: 'useDailyRecordStaff', hook: useDailyRecordStaff },
      { name: 'useDailyRecordActions', hook: useDailyRecordActions },
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
