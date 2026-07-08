import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import { attemptConflictAutoMergeRecovery } from '@/services/repositories/dailyRecordConflictAutoMergeController';

const {
  getRecordFromFirestoreMock,
  resolveConflictMock,
  buildConflictAutoMergeAuditDetailsMock,
  logRepositoryConflictAutoMergedMock,
  queueSyncTaskMock,
  loggerWarnMock,
  recordTelemetryMock,
  buildConflictIdMock,
  saveConflictVersionSnapshotsMock,
  evaluatePostMergeInvariantsMock,
} = vi.hoisted(() => ({
  getRecordFromFirestoreMock: vi.fn(),
  resolveConflictMock: vi.fn(),
  buildConflictAutoMergeAuditDetailsMock: vi.fn(),
  logRepositoryConflictAutoMergedMock: vi.fn(),
  queueSyncTaskMock: vi.fn(),
  loggerWarnMock: vi.fn(),
  recordTelemetryMock: vi.fn(),
  buildConflictIdMock: vi.fn(() => 'conflict-1'),
  saveConflictVersionSnapshotsMock: vi.fn(),
  evaluatePostMergeInvariantsMock: vi.fn(),
}));

vi.mock('@/services/storage/firestore/firestoreRecordQueries', () => ({
  getRecordFromFirestore: getRecordFromFirestoreMock,
}));

vi.mock('@/services/repositories/conflictResolutionMatrix', () => ({
  resolveDailyRecordConflictWithTrace: resolveConflictMock,
}));

vi.mock('@/services/repositories/conflictResolutionAuditSummary', () => ({
  buildConflictAutoMergeAuditDetails: buildConflictAutoMergeAuditDetailsMock,
}));

vi.mock('@/services/repositories/ports/repositoryAuditPort', () => ({
  logRepositoryConflictAutoMerged: logRepositoryConflictAutoMergedMock,
}));

vi.mock('@/services/storage/sync', () => ({
  queueDailyRecordSyncTaskWithLocalRecord: queueSyncTaskMock,
}));

vi.mock('@/services/repositories/repositoryLoggers', () => ({
  dailyRecordWriteSupportLogger: {
    warn: loggerWarnMock,
  },
}));

vi.mock('@/services/observability/operationalTelemetryOutcomeRecorder', () => ({
  recordOperationalErrorTelemetry: recordTelemetryMock,
}));

vi.mock('@/services/storage/firestore/dailyRecordConflictSnapshotService', () => ({
  buildConflictId: buildConflictIdMock,
  saveConflictVersionSnapshots: saveConflictVersionSnapshotsMock,
}));

vi.mock('@/services/repositories/dailyRecordConflictPostMergeInvariantChecker', () => ({
  evaluateDailyRecordConflictPostMergeInvariants: evaluatePostMergeInvariantsMock,
}));

const record = {
  date: '2026-04-15',
  schemaVersion: 1,
  beds: {},
  lastUpdated: '2026-04-15T12:00:00.000Z',
} as unknown as DailyRecord;

describe('dailyRecordConflictAutoMergeController', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    buildConflictIdMock.mockReturnValue('conflict-1');
    saveConflictVersionSnapshotsMock.mockResolvedValue({
      status: 'saved',
      snapshotIds: ['conflict-1__remote_premerge', 'conflict-1__incoming_premerge'],
      origins: ['remote_premerge', 'incoming_premerge'],
      expiresAt: '2026-04-17T12:00:00.000Z',
    });
    evaluatePostMergeInvariantsMock.mockReturnValue({
      record,
      status: 'ok',
      violations: [],
    });
  });

  it('returns not_possible when no remote record exists', async () => {
    getRecordFromFirestoreMock.mockResolvedValue(null);

    await expect(
      attemptConflictAutoMergeRecovery('2026-04-15', record, ['beds.R1.patientName'])
    ).resolves.toEqual({ status: 'not_possible' });
  });

  it('queues and audits the auto-merged record when recovery succeeds', async () => {
    getRecordFromFirestoreMock.mockResolvedValue(record);
    resolveConflictMock.mockReturnValue({
      record,
      trace: { policyVersion: 'v1', entries: [] },
    });
    buildConflictAutoMergeAuditDetailsMock.mockReturnValue({
      summary: 'ok',
      conflictId: 'conflict-1',
      snapshotRecovery: {
        status: 'saved',
        snapshotIds: ['conflict-1__remote_premerge', 'conflict-1__incoming_premerge'],
        origins: ['remote_premerge', 'incoming_premerge'],
        expiresAt: '2026-04-17T12:00:00.000Z',
      },
    });
    queueSyncTaskMock.mockResolvedValue({ accepted: true });

    await expect(
      attemptConflictAutoMergeRecovery('2026-04-15', record, ['beds.R1.patientName'])
    ).resolves.toEqual({ status: 'auto_merged' });

    expect(queueSyncTaskMock).toHaveBeenCalledWith(
      record,
      expect.objectContaining({
        origin: 'conflict_auto_merge',
        syncContract: expect.objectContaining({
          expectedVersion: '2026-04-15T12:00:00.000Z',
          changedPaths: ['beds.R1.patientName'],
          mutationId: expect.any(String),
          clientId: expect.any(String),
          tabId: expect.any(String),
        }),
      })
    );
    const queuedContract = queueSyncTaskMock.mock.calls[0]?.[1]?.syncContract;
    expect(buildConflictAutoMergeAuditDetailsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        syncContract: queuedContract,
      })
    );
    expect(logRepositoryConflictAutoMergedMock).toHaveBeenCalledWith(
      '2026-04-15',
      expect.objectContaining({
        conflictId: 'conflict-1',
        snapshotRecovery: {
          status: 'saved',
          snapshotIds: ['conflict-1__remote_premerge', 'conflict-1__incoming_premerge'],
          origins: ['remote_premerge', 'incoming_premerge'],
          expiresAt: '2026-04-17T12:00:00.000Z',
        },
      })
    );
  });

  it('returns not_possible and does not queue or audit when post-merge invariants block recovery', async () => {
    getRecordFromFirestoreMock.mockResolvedValue(record);
    resolveConflictMock.mockReturnValue({
      record,
      trace: { policyVersion: 'v1', entries: [] },
    });
    evaluatePostMergeInvariantsMock.mockReturnValue({
      record,
      status: 'blocked',
      violations: [
        {
          type: 'movement_missing_after_merge',
          path: 'discharges.discharge-1',
          message: 'El movimiento visible desaparecio tras el merge.',
        },
      ],
    });

    await expect(
      attemptConflictAutoMergeRecovery('2026-04-15', record, ['discharges'])
    ).resolves.toEqual({ status: 'not_possible' });

    expect(queueSyncTaskMock).not.toHaveBeenCalled();
    expect(buildConflictAutoMergeAuditDetailsMock).not.toHaveBeenCalled();
    expect(logRepositoryConflictAutoMergedMock).not.toHaveBeenCalled();
    expect(recordTelemetryMock).toHaveBeenCalledWith(
      'firestore',
      'conflict_auto_merge_invariants',
      expect.any(Error),
      expect.objectContaining({
        code: 'firestore_conflict_auto_merge_invariants_blocked',
        severity: 'warning',
      })
    );
  });

  it('stays best-effort but observable: telemeters when the audit fails, still auto_merged', async () => {
    getRecordFromFirestoreMock.mockResolvedValue(record);
    resolveConflictMock.mockReturnValue({ record, trace: { policyVersion: 'v1', entries: [] } });
    buildConflictAutoMergeAuditDetailsMock.mockReturnValue({
      summary: 'ok',
      conflictId: 'conflict-1',
      snapshotRecovery: {
        status: 'saved',
        snapshotIds: ['conflict-1__remote_premerge', 'conflict-1__incoming_premerge'],
        origins: ['remote_premerge', 'incoming_premerge'],
        expiresAt: '2026-04-17T12:00:00.000Z',
      },
    });
    queueSyncTaskMock.mockResolvedValue({ accepted: true });
    logRepositoryConflictAutoMergedMock.mockRejectedValueOnce(new Error('audit down'));

    await expect(
      attemptConflictAutoMergeRecovery('2026-04-15', record, ['beds.R1.patientName'])
    ).resolves.toEqual({ status: 'auto_merged' });

    // The merge proceeds (system recovery), but the audit failure is no longer silent.
    expect(recordTelemetryMock).toHaveBeenCalledWith(
      'firestore',
      'conflict_auto_merge_audit',
      expect.any(Error),
      expect.objectContaining({ code: 'firestore_conflict_auto_merge_audit_failed' })
    );
  });

  it('returns not_possible when queuing the merged record is rejected', async () => {
    getRecordFromFirestoreMock.mockResolvedValue(record);
    resolveConflictMock.mockReturnValue({
      record,
      trace: { policyVersion: 'v1', entries: [] },
    });
    buildConflictAutoMergeAuditDetailsMock.mockReturnValue({
      summary: 'ok',
      conflictId: 'conflict-1',
      snapshotRecovery: {
        status: 'saved',
        snapshotIds: ['conflict-1__remote_premerge', 'conflict-1__incoming_premerge'],
        origins: ['remote_premerge', 'incoming_premerge'],
        expiresAt: '2026-04-17T12:00:00.000Z',
      },
    });
    queueSyncTaskMock.mockResolvedValue({ accepted: false });

    await expect(
      attemptConflictAutoMergeRecovery('2026-04-15', record, ['beds.R1.patientName'])
    ).resolves.toEqual({ status: 'not_possible' });
  });
});
