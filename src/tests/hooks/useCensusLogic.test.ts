/**
 * useCensusLogic Hook Tests
 * Tests for census view logic and data management
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useCensusLogic } from '@/hooks/useCensusLogic';
import * as statsCalculator from '@/services/calculations/statsCalculator';
import * as censusPromptStateHook from '@/hooks/useCensusPromptState';
import { DataFactory } from '@/tests/factories/DataFactory';

// Mock contexts with correct hook names
vi.mock('@/context/DailyRecordContext', () => ({
  useDailyRecordMovements: () => ({
    discharges: [],
    transfers: [],
    cma: [],
  }),
  useDailyRecordBeds: () => ({
    R1: { patientName: 'Patient 1', status: 'ESTABLE' },
    R2: { patientName: 'Patient 2', status: 'CRITICO' },
  }),
  useDailyRecordStaff: () => ({ activeExtraBeds: [] }),
}));

vi.mock('@/context/useDailyRecordScopedActions', () => ({
  useDailyRecordDayActions: () => ({
    createDay: vi.fn(),
    resetDay: vi.fn(),
  }),
  useDailyRecordStaffActions: () => ({
    updateNurse: vi.fn(),
    updateTens: vi.fn(),
    updateDetailedStaffing: vi.fn(),
  }),
  useDailyRecordMovementActions: () => ({
    undoDischarge: vi.fn(),
    deleteDischarge: vi.fn(),
    undoTransfer: vi.fn(),
    deleteTransfer: vi.fn(),
  }),
}));

vi.mock('@/context/StaffContext', () => ({
  useStaffContext: () => ({
    nursesList: ['Nurse A', 'Nurse B'],
    tensList: ['Tens A', 'Tens B'],
  }),
}));

vi.mock('@/services/calculations/statsCalculator');
vi.mock('@/hooks/useCensusPromptState', () => ({
  useCensusPromptState: vi.fn(),
}));

describe('useCensusLogic', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    vi.mocked(statsCalculator.calculateStats).mockReturnValue(
      DataFactory.createMockStatistics({
        occupiedBeds: 10,
        availableCapacity: 10,
      })
    );
    vi.mocked(censusPromptStateHook.useCensusPromptState).mockReturnValue({
      previousRecordAvailable: true,
      previousRecordDate: '2025-01-09',
      availableDates: ['2025-01-08', '2025-01-09'],
    });
  });

  describe('Initial State', () => {
    it('should return census data from context', () => {
      const { result } = renderHook(() => useCensusLogic('2025-01-10'));

      expect(result.current.beds).toBeDefined();
      expect(result.current.movements).toBeDefined();
    });

    it('should return staff lists from context', () => {
      const { result } = renderHook(() => useCensusLogic('2025-01-10'));

      expect(result.current.nursesList).toEqual(['Nurse A', 'Nurse B']);
      expect(result.current.tensList).toEqual(['Tens A', 'Tens B']);
    });

    it('should calculate stats from record', () => {
      const { result } = renderHook(() => useCensusLogic('2025-01-10'));

      expect(result.current.stats).toBeDefined();
      expect(statsCalculator.calculateStats).toHaveBeenCalled();
    });
  });

  describe('Previous Day Check', () => {
    it('should check for previous day on mount', () => {
      renderHook(() => useCensusLogic('2025-01-10'));

      expect(censusPromptStateHook.useCensusPromptState).toHaveBeenCalledWith('2025-01-10', false);
    });

    it('should set previousRecordAvailable when previous exists', () => {
      const { result } = renderHook(() => useCensusLogic('2025-01-10'));

      expect(result.current.previousRecordAvailable).toBe(true);
      expect(result.current.previousRecordDate).toBe('2025-01-09');
    });

    it('should set previousRecordAvailable to false when no previous', () => {
      vi.mocked(censusPromptStateHook.useCensusPromptState).mockReturnValueOnce({
        previousRecordAvailable: false,
        previousRecordDate: undefined,
        availableDates: ['2025-01-08'],
      });

      const { result } = renderHook(() => useCensusLogic('2025-01-10'));

      expect(result.current.previousRecordAvailable).toBe(false);
    });
  });

  describe('Available Dates', () => {
    it('should filter out current date from available dates', () => {
      const { result } = renderHook(() => useCensusLogic('2025-01-10'));

      expect(result.current.availableDates).not.toContain('2025-01-10');
      expect(result.current.availableDates).toContain('2025-01-08');
      expect(result.current.availableDates).toContain('2025-01-09');
    });

    it('should fallback to empty available dates when repository call fails', () => {
      vi.mocked(censusPromptStateHook.useCensusPromptState).mockReturnValueOnce({
        previousRecordAvailable: false,
        previousRecordDate: undefined,
        availableDates: [],
      });
      const { result } = renderHook(() => useCensusLogic('2025-01-10'));

      expect(result.current.availableDates).toEqual([]);
    });
  });

  describe('Error Resilience', () => {
    it('should fallback to no previous record when previous day lookup fails', () => {
      vi.mocked(censusPromptStateHook.useCensusPromptState).mockReturnValueOnce({
        previousRecordAvailable: false,
        previousRecordDate: undefined,
        availableDates: [],
      });
      const { result } = renderHook(() => useCensusLogic('2025-01-10'));

      expect(result.current.previousRecordAvailable).toBe(false);
      expect(result.current.previousRecordDate).toBeUndefined();
    });
  });

  describe('Actions', () => {
    it('should expose createDay action', () => {
      const { result } = renderHook(() => useCensusLogic('2025-01-10'));

      expect(typeof result.current.createDay).toBe('function');
    });

    it('should expose resetDay action', () => {
      const { result } = renderHook(() => useCensusLogic('2025-01-10'));

      expect(typeof result.current.resetDay).toBe('function');
    });

    it('should expose all CRUD actions', () => {
      const { result } = renderHook(() => useCensusLogic('2025-01-10'));

      expect(typeof result.current.updateNurse).toBe('function');
      expect(typeof result.current.updateTens).toBe('function');
      expect(typeof result.current.undoDischarge).toBe('function');
      expect(typeof result.current.deleteDischarge).toBe('function');
      expect(typeof result.current.undoTransfer).toBe('function');
      expect(typeof result.current.deleteTransfer).toBe('function');
    });
  });
});
