import { describe, expect, it } from 'vitest';
import { hasUnchangedRayenStructuralState } from '@/features/rayen-import/domain/rayenStructuralCheckpoint';
import type { DailyRecord } from '@/types/domain/dailyRecord';

const record = (): DailyRecord =>
  ({
    date: '2026-08-27',
    beds: {},
    activeExtraBeds: [],
    discharges: [],
    transfers: [],
    cma: [],
    lastUpdated: '2026-08-27T10:00:00.000Z',
  }) as DailyRecord;

describe('hasUnchangedRayenStructuralState', () => {
  it('ignores audit timestamps and Rayen history metadata', () => {
    const before = record();
    const after = {
      ...before,
      lastUpdated: '2026-08-27T10:01:00.000Z',
      rayenSync: {
        at: '2026-08-27T10:01:00.000Z',
        by: 'Operador HHR',
        runId: 'run-1',
        status: 'applied',
      },
    } as DailyRecord;

    expect(hasUnchangedRayenStructuralState(before, after)).toBe(true);
  });

  it('rejects a metadata checkpoint when an occupancy-only bed changes availability', () => {
    const before = record();
    const after = { ...before, activeExtraBeds: ['BOX 1 UEA'] } as DailyRecord;

    expect(hasUnchangedRayenStructuralState(before, after)).toBe(false);
  });

  it('rejects a metadata checkpoint when a movement collection changes', () => {
    const before = record();
    const after = {
      ...before,
      discharges: [{ id: 'movement-1' }],
    } as DailyRecord;

    expect(hasUnchangedRayenStructuralState(before, after)).toBe(false);
  });
});
