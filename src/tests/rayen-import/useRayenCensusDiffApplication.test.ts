import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { CensusImportDiff } from '@/features/rayen-import/contracts/censusImportDiff';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import { useRayenCensusDiffApplication } from '@/features/rayen-import/hooks/useRayenCensusDiffApplication';

const baseRecord = {
  date: '2026-08-07',
  beds: {},
  discharges: [],
  transfers: [],
  cma: [],
  activeExtraBeds: [],
  lastUpdated: '2026-08-07T23:00:00.000Z',
} as DailyRecord;

const diff = {
  admissions: [],
  updates: [],
  moves: [],
  discharges: [],
  pendingAdministrativeDischarges: [],
  conflicts: [],
  unchangedCount: 0,
  summary: {
    admissions: 0,
    updates: 0,
    moves: 0,
    discharges: 0,
    pendingAdministrativeDischarges: 0,
    conflicts: 0,
    unchanged: 0,
  },
} as CensusImportDiff;

describe('useRayenCensusDiffApplication', () => {
  it('persists a historical census with the revision of its base, not its new timestamp', async () => {
    const run = {
      id: 'run-x-minus-one',
      startedAt: '2026-08-08T01:00:00.000Z',
      by: 'Operador HHR',
      sourceDate: '2026-08-07',
    };
    const saveDailyRecord = vi.fn(async (record: DailyRecord, _expectedLastUpdated: string) => ({
      record,
      result: {
        date: record.date,
        outcome: 'clean',
        confirmedRecord: record,
      },
    }));
    const applyRunToRecord = vi.fn((record: DailyRecord) => ({
      record: {
        ...record,
        rayenSync: { runId: run.id },
        rayenSyncHistory: [{ id: run.id, status: 'applied' }],
      } as DailyRecord,
    }));
    const { result } = renderHook(() =>
      useRayenCensusDiffApplication({
        ensureRun: () => run as never,
        applyRunToRecord,
        saveDailyRecord: saveDailyRecord as never,
        recordRunPerformance: vi.fn(),
      })
    );

    await act(async () => {
      await result.current(baseRecord, diff);
    });

    const [savedRecord, expectedLastUpdated] = saveDailyRecord.mock.calls[0];
    expect(savedRecord.lastUpdated).not.toBe(baseRecord.lastUpdated);
    expect(expectedLastUpdated).toBe(baseRecord.lastUpdated);
  });
});
