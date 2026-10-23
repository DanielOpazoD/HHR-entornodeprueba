import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HISTORY_SNAPSHOT_INTERVAL_MS } from '@/services/storage/firestore/historySnapshotCadence';

// Fresh module per test: the in-memory fallback lives as long as the tab.
const loadCadence = async () => {
  vi.resetModules();
  return import('@/services/storage/firestore/historySnapshotCadence');
};

const DAY = 'hospitals/h/dailyRecords/2026-10-23';
const OTHER_DAY = 'hospitals/h/dailyRecords/2026-10-22';
const T0 = Date.parse('2026-10-23T08:00:00.000Z');

describe('history snapshot cadence', () => {
  beforeEach(() => localStorage.clear());

  it('is due until a copy is taken, then again only after an hour, per document', async () => {
    const { isHistorySnapshotDue, markHistorySnapshotTaken } = await loadCadence();
    expect(isHistorySnapshotDue(DAY, T0)).toBe(true);
    markHistorySnapshotTaken(DAY, T0);

    expect(isHistorySnapshotDue(DAY, T0 + HISTORY_SNAPSHOT_INTERVAL_MS - 1)).toBe(false);
    expect(isHistorySnapshotDue(OTHER_DAY, T0 + 1)).toBe(true);
    expect(isHistorySnapshotDue(DAY, T0 + HISTORY_SNAPSHOT_INTERVAL_MS)).toBe(true);
  });

  it('copies again when the device clock moved back before the last copy', async () => {
    const { isHistorySnapshotDue, markHistorySnapshotTaken } = await loadCadence();
    markHistorySnapshotTaken(DAY, T0);
    expect(isHistorySnapshotDue(DAY, T0 - 60_000)).toBe(true);
  });

  it('is shared by every tab of the device and forgets entries older than two days', async () => {
    const { markHistorySnapshotTaken } = await loadCadence();
    markHistorySnapshotTaken(OTHER_DAY, T0 - 3 * 24 * HISTORY_SNAPSHOT_INTERVAL_MS);
    markHistorySnapshotTaken(DAY, T0);

    const stored = JSON.parse(localStorage.getItem('hhr_history_snapshot_cadence_v1') ?? '{}');
    expect(stored).toEqual({ [DAY]: T0 });
  });

  it('falls back to what this tab wrote when storage holds something malformed', async () => {
    const { isHistorySnapshotDue, markHistorySnapshotTaken } = await loadCadence();
    localStorage.setItem('hhr_history_snapshot_cadence_v1', '[1,2,3]');
    expect(isHistorySnapshotDue(DAY, T0)).toBe(true);

    markHistorySnapshotTaken(DAY, T0);
    localStorage.setItem('hhr_history_snapshot_cadence_v1', '{not json');
    expect(isHistorySnapshotDue(DAY, T0 + 1)).toBe(false);
    expect(isHistorySnapshotDue(OTHER_DAY, T0 + 1)).toBe(true);
  });

  it('still bounds copies in memory when storage refuses writes but can be read', async () => {
    const { isHistorySnapshotDue, markHistorySnapshotTaken } = await loadCadence();
    // The test setup replaces localStorage with a plain mock object: swap its method directly.
    const originalSetItem = localStorage.setItem;
    localStorage.setItem = () => {
      throw new Error('synthetic quota exceeded');
    };
    try {
      markHistorySnapshotTaken(DAY, T0);
      expect(localStorage.getItem('hhr_history_snapshot_cadence_v1')).toBeNull();
      expect(isHistorySnapshotDue(DAY, T0 + 1)).toBe(false);
    } finally {
      localStorage.setItem = originalSetItem;
    }
  });

  it('uses memory when storage cannot even be read', async () => {
    const { isHistorySnapshotDue, markHistorySnapshotTaken } = await loadCadence();
    markHistorySnapshotTaken(DAY, T0);
    const originalGetItem = localStorage.getItem;
    localStorage.getItem = () => {
      throw new Error('synthetic storage unavailable');
    };
    try {
      expect(isHistorySnapshotDue(DAY, T0 + 1)).toBe(false);
    } finally {
      localStorage.getItem = originalGetItem;
    }
  });

  it('copies again after logout clears the stored marks', async () => {
    const { isHistorySnapshotDue, markHistorySnapshotTaken } = await loadCadence();
    markHistorySnapshotTaken(DAY, T0);
    localStorage.removeItem('hhr_history_snapshot_cadence_v1');
    expect(isHistorySnapshotDue(DAY, T0 + 1)).toBe(true);
  });
});
