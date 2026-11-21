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

const contextState = vi.hoisted(() => ({
  beds: null as Record<string, unknown> | null,
  bootstrapPhase: 'local_only' as string,
}));
const POPULATED_BEDS = {
  R1: { patientName: 'Patient 1', status: 'ESTABLE' },
  R2: { patientName: 'Patient 2', status: 'CRITICO' },
};

// Mock contexts with correct hook names
vi.mock('@/context/DailyRecordContext', () => ({
  useDailyRecordStatus: () => ({ bootstrapPhase: contextState.bootstrapPhase }),
  useDailyRecordBeds: () => contextState.beds,
  useDailyRecordStaff: () => ({ activeExtraBeds: [] }),
}));

vi.mock('@/context/useDailyRecordScopedActions', () => ({
  useDailyRecordDayActions: () => ({
    createDay: vi.fn(),
    resetDay: vi.fn(),
  }),
}));

vi.mock('@/services/calculations/statsCalculator');
vi.mock('@/hooks/useCensusPromptState', () => ({
  useCensusPromptState: vi.fn(),
}));

describe('useCensusLogic', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    contextState.beds = POPULATED_BEDS;
    contextState.bootstrapPhase = 'local_only';

    vi.mocked(statsCalculator.calculateStats).mockReturnValue(
      DataFactory.createMockStatistics({
        occupiedBeds: 10,
        availableCapacity: 10,
      })
    );
    vi.mocked(censusPromptStateHook.useCensusPromptState).mockReturnValue({
      previousRecordAvailable: true,
      previousRecordDate: '2025-01-09',
    });
  });

  describe('Initial State', () => {
    it('should return census data from context', () => {
      const { result } = renderHook(() => useCensusLogic('2025-01-10'));

      expect(result.current.beds).toBe(POPULATED_BEDS);
      expect(result.current.staff).toEqual({ activeExtraBeds: [] });
    });

    it('should calculate stats from record', () => {
      const { result } = renderHook(() => useCensusLogic('2025-01-10'));

      expect(result.current.stats).toBeDefined();
      expect(statsCalculator.calculateStats).toHaveBeenCalled();
    });
  });

  describe('Copy prompt demand', () => {
    it.each([
      ['while the day is still loading', null, 'remote_record_bootstrapping', false],
      ['for a day only known locally so far', null, 'local_only', false],
      ['once the day is confirmed empty', null, 'confirmed_empty', true],
      ['for a populated day', POPULATED_BEDS, 'confirmed_empty', false],
    ])('asks for the copy source only %s', (_case, beds, bootstrapPhase, enabled) => {
      contextState.beds = beds;
      contextState.bootstrapPhase = bootstrapPhase;
      renderHook(() => useCensusLogic('2025-01-10'));
      expect(censusPromptStateHook.useCensusPromptState).toHaveBeenCalledWith(
        '2025-01-10',
        enabled
      );
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
      });

      const { result } = renderHook(() => useCensusLogic('2025-01-10'));

      expect(result.current.previousRecordAvailable).toBe(false);
    });
  });

  describe('Error Resilience', () => {
    it('should fallback to no previous record when previous day lookup fails', () => {
      vi.mocked(censusPromptStateHook.useCensusPromptState).mockReturnValueOnce({
        previousRecordAvailable: false,
        previousRecordDate: undefined,
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
  });
});
