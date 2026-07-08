import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockBatchSet, mockBatchCommit, mockGetDoc, mockGetDocs } = vi.hoisted(() => ({
  mockBatchSet: vi.fn(),
  mockBatchCommit: vi.fn().mockResolvedValue(undefined),
  mockGetDoc: vi.fn(),
  mockGetDocs: vi.fn(),
}));

vi.mock('firebase/firestore', async () => {
  const actual = await vi.importActual('firebase/firestore');
  class MockTimestamp {
    constructor(public millis: number) {}
    static now = vi.fn(() => new MockTimestamp(1_000));
    static fromMillis = vi.fn((millis: number) => new MockTimestamp(millis));
  }
  return {
    ...actual,
    collection: vi.fn((...args: unknown[]) => ({ kind: 'collection', args })),
    doc: vi.fn((parent: unknown, id: string) => ({ kind: 'doc', parent, id })),
    getDoc: (...args: unknown[]) => mockGetDoc(...args),
    getDocs: (...args: unknown[]) => mockGetDocs(...args),
    Timestamp: MockTimestamp,
    writeBatch: vi.fn(() => ({ set: mockBatchSet, commit: mockBatchCommit })),
  };
});

vi.mock('@/services/storage/firestore/firestoreShared', () => ({
  getRecordDocRef: vi.fn((date: string) => ({ kind: 'recordDocRef', date })),
  sanitizeForFirestore: vi.fn((value: unknown) => value),
}));

vi.mock('@/services/storage/firestore/firestoreServiceRuntime', () => ({
  defaultFirestoreServiceRuntime: { getDb: () => ({ kind: 'db' }) },
}));

const mockTelemetry = vi.fn();
vi.mock('@/services/observability/operationalTelemetryOutcomeRecorder', () => ({
  recordOperationalErrorTelemetry: (...args: unknown[]) => mockTelemetry(...args),
}));

import { Timestamp } from 'firebase/firestore';
import {
  buildConflictId,
  CONFLICT_SNAPSHOT_TTL_MS,
  getConflictVersionSnapshot,
  listConflictVersionSnapshots,
  saveConflictVersionSnapshots,
} from '@/services/storage/firestore/dailyRecordConflictSnapshotService';
import type { DailyRecord } from '@/types/domain/dailyRecord';

const rec = (lastUpdated: string, patientName: string): DailyRecord =>
  ({ date: '2026-06-26', lastUpdated, beds: { R1: { patientName } } }) as never;

describe('dailyRecordConflictSnapshotService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockBatchCommit.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('buildConflictId', () => {
    it('is deterministic and doc-id-safe (no `:` or `.`)', () => {
      const remote = rec('2026-06-26T10:00:00.000Z', 'X');
      const incoming = rec('2026-06-26T09:00:00.000Z', 'Y');

      const first = buildConflictId('2026-06-26', remote, incoming);
      expect(buildConflictId('2026-06-26', remote, incoming)).toBe(first);
      expect(first).not.toMatch(/[^A-Za-z0-9_-]/);
    });

    it('differs when a conflicting version changes', () => {
      const remote = rec('2026-06-26T10:00:00.000Z', 'X');
      const incomingA = rec('2026-06-26T09:00:00.000Z', 'Y');
      const incomingB = rec('2026-06-26T11:00:00.000Z', 'Z');

      expect(buildConflictId('2026-06-26', remote, incomingA)).not.toBe(
        buildConflictId('2026-06-26', remote, incomingB)
      );
    });
  });

  it('writes both pre-merge versions with origin, conflictId and expireAt, then commits', async () => {
    await saveConflictVersionSnapshots('2026-06-26', 'cid-1', {
      remote: rec('2026-06-26T10:00:00.000Z', 'Remoto'),
      incoming: rec('2026-06-26T09:00:00.000Z', 'Local'),
    });

    expect(mockBatchSet).toHaveBeenCalledTimes(2);
    const origins = mockBatchSet.mock.calls.map(call => (call[1] as { origin: string }).origin);
    expect(origins).toEqual(['remote_premerge', 'incoming_premerge']);
    for (const call of mockBatchSet.mock.calls) {
      const data = call[1] as Record<string, unknown>;
      expect(data.conflictId).toBe('cid-1');
      expect(data.expireAt).toBeDefined();
      expect(data.record).toBeDefined();
    }
    expect(mockBatchCommit).toHaveBeenCalledTimes(1);
  });

  it('sets expireAt at roughly now + 48h', async () => {
    const now = new Date('2026-06-26T12:00:00.000Z');
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(now);

    const before = Date.now();
    await saveConflictVersionSnapshots('2026-06-26', 'cid', {
      remote: rec('a', 'R'),
      incoming: rec('b', 'L'),
    });
    const after = Date.now();

    const calledWith = (Timestamp.fromMillis as unknown as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as number;
    expect(calledWith).toBeGreaterThanOrEqual(before + CONFLICT_SNAPSHOT_TTL_MS);
    expect(calledWith).toBeLessThanOrEqual(after + CONFLICT_SNAPSHOT_TTL_MS);
  });

  it('swallows failures into telemetry (best-effort, never throws)', async () => {
    mockBatchCommit.mockRejectedValueOnce(new Error('offline'));

    await expect(
      saveConflictVersionSnapshots('2026-06-26', 'cid', {
        remote: rec('a', 'R'),
        incoming: rec('b', 'L'),
      })
    ).resolves.toMatchObject({
      status: 'failed',
      snapshotIds: [],
      origins: [],
      ttlMs: CONFLICT_SNAPSHOT_TTL_MS,
    });

    expect(mockTelemetry).toHaveBeenCalledWith(
      'firestore',
      'save_conflict_version_snapshots',
      expect.any(Error),
      expect.objectContaining({ code: 'firestore_conflict_snapshot_failed' })
    );
  });

  it('lists only still-recoverable snapshots, filtering out any past expireAt (TTL grace window)', async () => {
    const ts = (millis: number) => ({ toMillis: () => millis });
    const now = Date.now();
    mockGetDocs.mockResolvedValueOnce({
      docs: [
        {
          id: 'cid__remote_premerge',
          data: () => ({
            origin: 'remote_premerge',
            expireAt: ts(now + 60_000),
            record: { date: '2026-06-26' },
          }),
        },
        {
          id: 'cid__incoming_premerge',
          data: () => ({
            origin: 'incoming_premerge',
            expireAt: ts(now - 60_000),
            record: { date: '2026-06-26' },
          }),
        },
      ],
    });

    const result = await listConflictVersionSnapshots('2026-06-26');

    expect(result.map(s => s.id)).toEqual(['cid__remote_premerge']);
  });

  it('returns null for an expired snapshot read directly by id', async () => {
    const ts = (millis: number) => ({ toMillis: () => millis });
    const now = Date.now();
    mockGetDoc.mockResolvedValueOnce({
      exists: () => true,
      id: 'cid__remote_premerge',
      data: () => ({
        origin: 'remote_premerge',
        expireAt: ts(now - 60_000),
        record: { date: '2026-06-26' },
      }),
    });

    await expect(
      getConflictVersionSnapshot('2026-06-26', 'cid__remote_premerge')
    ).resolves.toBeNull();
  });
});
