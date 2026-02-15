/**
 * useCensusLogic Hook Tests
 * Tests for census view logic and data management
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useCensusLogic } from '@/hooks/useCensusLogic';
import * as DailyRecordRepository from '@/services/repositories/DailyRecordRepository';
import * as statsCalculator from '@/services/calculations/statsCalculator';
import { DataFactory } from '@/tests/factories/DataFactory';

// Mock contexts with correct hook names
vi.mock('@/context/DailyRecordContext', () => ({
  useDailyRecordData: () => ({
    record: {
      date: '2025-01-10',
      beds: {
        R1: { patientName: 'Patient 1', status: 'ESTABLE' },
        R2: { patientName: 'Patient 2', status: 'CRITICO' },
      },
    },
  }),
  useDailyRecordActions: () => ({
    createDay: vi.fn(),
    resetDay: vi.fn(),
    updateNurse: vi.fn(),
    updateTens: vi.fn(),
    undoDischarge: vi.fn(),
    deleteDischarge: vi.fn(),
    undoTransfer: vi.fn(),
    deleteTransfer: vi.fn(),
  }),
  useDailyRecordMovements: () => ({
    discharges: [],
    transfers: [],
    cma: [],
  }),
  useDailyRecordBeds: () => ({}),
  useDailyRecordStaff: () => ({ activeExtraBeds: [] }),
}));

vi.mock('@/context/StaffContext', () => ({
  useStaffContext: () => ({
    nursesList: ['Nurse A', 'Nurse B'],
    tensList: ['Tens A', 'Tens B'],
  }),
}));

vi.mock('@/services/repositories/DailyRecordRepository');
vi.mock('@/services/calculations/statsCalculator');

describe('useCensusLogic', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Setup default mocks
    vi.mocked(DailyRecordRepository.getPreviousDay).mockResolvedValue(
      DataFactory.createMockDailyRecord('2025-01-09')
    );
    vi.mocked(DailyRecordRepository.getAvailableDates).mockResolvedValue([
      '2025-01-08',
      '2025-01-09',
      '2025-01-10',
    ]);
    vi.mocked(statsCalculator.calculateStats).mockReturnValue(
      DataFactory.createMockStatistics({
        occupiedBeds: 10,
        availableCapacity: 10,
      })
    );
  });

  describe('Initial State', () => {
    it('should return census data from context', async () => {
      const { result } = renderHook(() => useCensusLogic('2025-01-10'));

      expect(result.current.beds).toBeDefined();
      expect(result.current.movements).toBeDefined();
      await waitFor(() => {
        expect(DailyRecordRepository.getPreviousDay).toHaveBeenCalled();
      });
    });

    it('should return staff lists from context', async () => {
      const { result } = renderHook(() => useCensusLogic('2025-01-10'));

      expect(result.current.nursesList).toEqual(['Nurse A', 'Nurse B']);
      expect(result.current.tensList).toEqual(['Tens A', 'Tens B']);
      await waitFor(() => {
        expect(DailyRecordRepository.getAvailableDates).toHaveBeenCalled();
      });
    });

    it('should calculate stats from record', async () => {
      const { result } = renderHook(() => useCensusLogic('2025-01-10'));

      expect(result.current.stats).toBeDefined();
      expect(statsCalculator.calculateStats).toHaveBeenCalled();
      await waitFor(() => {
        expect(DailyRecordRepository.getPreviousDay).toHaveBeenCalled();
      });
    });
  });

  describe('Previous Day Check', () => {
    it('should check for previous day on mount', async () => {
      renderHook(() => useCensusLogic('2025-01-10'));

      await waitFor(() => {
        expect(DailyRecordRepository.getPreviousDay).toHaveBeenCalledWith('2025-01-10');
      });
    });

    it('should set previousRecordAvailable when previous exists', async () => {
      const { result } = renderHook(() => useCensusLogic('2025-01-10'));

      await waitFor(() => {
        expect(result.current.previousRecordAvailable).toBe(true);
        expect(result.current.previousRecordDate).toBe('2025-01-09');
      });
    });

    it('should set previousRecordAvailable to false when no previous', async () => {
      vi.mocked(DailyRecordRepository.getPreviousDay).mockResolvedValue(null);

      const { result } = renderHook(() => useCensusLogic('2025-01-10'));

      await waitFor(() => {
        expect(result.current.previousRecordAvailable).toBe(false);
      });
    });
  });

  describe('Available Dates', () => {
    it('should fetch available dates on mount', async () => {
      renderHook(() => useCensusLogic('2025-01-10'));

      await waitFor(() => {
        expect(DailyRecordRepository.getAvailableDates).toHaveBeenCalled();
      });
    });

    it('should filter out current date from available dates', async () => {
      const { result } = renderHook(() => useCensusLogic('2025-01-10'));

      await waitFor(() => {
        expect(result.current.availableDates).not.toContain('2025-01-10');
        expect(result.current.availableDates).toContain('2025-01-08');
        expect(result.current.availableDates).toContain('2025-01-09');
      });
    });

    it('should fallback to empty available dates when repository call fails', async () => {
      vi.mocked(DailyRecordRepository.getAvailableDates).mockRejectedValue(
        new Error('dates failed')
      );
      const { result } = renderHook(() => useCensusLogic('2025-01-10'));

      await waitFor(() => {
        expect(result.current.availableDates).toEqual([]);
      });
    });
  });

  describe('Error Resilience', () => {
    it('should fallback to no previous record when previous day lookup fails', async () => {
      vi.mocked(DailyRecordRepository.getPreviousDay).mockRejectedValue(new Error('prev failed'));
      const { result } = renderHook(() => useCensusLogic('2025-01-10'));

      await waitFor(() => {
        expect(result.current.previousRecordAvailable).toBe(false);
        expect(result.current.previousRecordDate).toBeUndefined();
      });
    });
  });

  describe('Actions', () => {
    it('should expose createDay action', async () => {
      const { result } = renderHook(() => useCensusLogic('2025-01-10'));

      expect(typeof result.current.createDay).toBe('function');
      await waitFor(() => {
        expect(DailyRecordRepository.getPreviousDay).toHaveBeenCalled();
      });
    });

    it('should expose resetDay action', async () => {
      const { result } = renderHook(() => useCensusLogic('2025-01-10'));

      expect(typeof result.current.resetDay).toBe('function');
      await waitFor(() => {
        expect(DailyRecordRepository.getPreviousDay).toHaveBeenCalled();
      });
    });

    it('should expose all CRUD actions', async () => {
      const { result } = renderHook(() => useCensusLogic('2025-01-10'));

      expect(typeof result.current.updateNurse).toBe('function');
      expect(typeof result.current.updateTens).toBe('function');
      expect(typeof result.current.undoDischarge).toBe('function');
      expect(typeof result.current.deleteDischarge).toBe('function');
      expect(typeof result.current.undoTransfer).toBe('function');
      expect(typeof result.current.deleteTransfer).toBe('function');
      await waitFor(() => {
        expect(DailyRecordRepository.getAvailableDates).toHaveBeenCalled();
      });
    });
  });
});
