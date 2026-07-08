import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  deleteUserHealthSnapshot,
  reportUserHealth,
  reopenSystemHealthIncident,
  resolveSystemHealthIncident,
  subscribeToSystemHealth,
  subscribeToSystemHealthIncidentResolutions,
  getSystemHealthSnapshot,
  normalizeUserHealthStatus,
  buildSystemHealthSummary,
  UserHealthStatus,
} from '@/services/admin/healthService';

// Mock the db abstraction layer
vi.mock('@/services/storage/firestore', () => ({
  firestoreDb: {
    getDoc: vi.fn().mockResolvedValue(null),
    setDoc: vi.fn().mockResolvedValue(undefined),
    deleteDoc: vi.fn().mockResolvedValue(undefined),
    getDocs: vi.fn().mockResolvedValue([]),
    subscribeQuery: vi.fn().mockImplementation((_path, _options, _callback) => {
      // Return an unsubscribe function
      return vi.fn();
    }),
  },
}));

// Import the mocked db after mocking
import { firestoreDb } from '@/services/storage/firestore';

describe('healthService', () => {
  const mockStatus: UserHealthStatus = {
    uid: 'user123',
    email: 'test@example.com',
    displayName: 'Test User',
    lastSeen: '2025-01-01T10:00:00Z',
    isOnline: true,
    isOutdated: false,
    pendingMutations: 0,
    pendingSyncTasks: 0,
    failedSyncTasks: 0,
    conflictSyncTasks: 0,
    retryingSyncTasks: 0,
    syncOrphanedTasks: 0,
    oldestPendingAgeMs: 0,
    remoteSyncReason: 'ready',
    versionUpdateReason: 'current',
    localErrorCount: 0,
    degradedLocalPersistence: false,
    repositoryWarningCount: 0,
    slowestRepositoryOperationMs: 0,
    operationalObservedCount: 0,
    operationalFailureCount: 0,
    operationalRetryableCount: 0,
    operationalRecoverableCount: 0,
    operationalDegradedCount: 0,
    operationalBlockedCount: 0,
    operationalUnauthorizedCount: 0,
    operationalLastHourObservedCount: 0,
    operationalSyncObservedCount: 0,
    operationalIndexedDbObservedCount: 0,
    operationalClinicalDocumentObservedCount: 0,
    operationalCreateDayObservedCount: 0,
    operationalHandoffObservedCount: 0,
    operationalExportBackupObservedCount: 0,
    operationalDailyRecordRecoveredRealtimeNullCount: 0,
    operationalDailyRecordConfirmedRealtimeNullCount: 0,
    operationalSyncReadUnavailableCount: 0,
    operationalIndexedDbFallbackModeCount: 0,
    operationalAuthBootstrapTimeoutCount: 0,
    operationalTopObservedCategory: undefined,
    operationalTopObservedOperation: undefined,
    latestOperationalOperation: undefined,
    latestOperationalRuntimeState: undefined,
    appVersion: '1.0.0',
    platform: 'MacIntel',
    userAgent: 'Mozilla/5.0',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(firestoreDb.getDoc).mockResolvedValue(null);
  });

  describe('reportUserHealth', () => {
    it('should silence permission errors', async () => {
      vi.mocked(firestoreDb.setDoc).mockRejectedValueOnce(
        new Error('FirebaseError: Missing or insufficient permissions.')
      );
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      await reportUserHealth(mockStatus);

      expect(warnSpy).not.toHaveBeenCalled();
      expect(errorSpy).not.toHaveBeenCalled();
      warnSpy.mockRestore();
      errorSpy.mockRestore();
    });

    it('should call db.setDoc with correct arguments', async () => {
      await reportUserHealth(mockStatus);
      expect(firestoreDb.setDoc).toHaveBeenCalledWith(
        expect.stringContaining('users'),
        'user123',
        expect.objectContaining({ uid: 'user123', email: 'test@example.com' })
      );
    });

    it('should handle errors gracefully', async () => {
      vi.mocked(firestoreDb.setDoc).mockRejectedValueOnce(new Error('Firebase Error'));
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      await reportUserHealth(mockStatus);

      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });

  describe('deleteUserHealthSnapshot', () => {
    it('deletes the selected user health snapshot from the users subcollection', async () => {
      await deleteUserHealthSnapshot('user123');

      expect(firestoreDb.deleteDoc).toHaveBeenCalledWith(
        expect.stringContaining('users'),
        'user123'
      );
    });
  });

  describe('system health incident resolutions', () => {
    it('persists a resolved incident with actor and audit history', async () => {
      await resolveSystemHealthIncident({
        resolutionKey: 'u1:event-1',
        resolvedAt: '2026-05-22T14:15:00.000Z',
        actor: {
          uid: 'admin-1',
          email: 'admin@example.com',
          displayName: 'Admin User',
        },
        note: 'Se corrigio permiso Firestore',
      });

      expect(firestoreDb.setDoc).toHaveBeenCalledWith(
        'stats/system_health/resolutions',
        'u1%3Aevent-1',
        expect.objectContaining({
          resolutionKey: 'u1:event-1',
          status: 'resolved',
          resolvedAt: '2026-05-22T14:15:00.000Z',
          resolvedByUid: 'admin-1',
          resolvedByEmail: 'admin@example.com',
          resolvedByName: 'Admin User',
          note: 'Se corrigio permiso Firestore',
          history: [
            expect.objectContaining({
              action: 'resolved',
              at: '2026-05-22T14:15:00.000Z',
              actorUid: 'admin-1',
            }),
          ],
        }),
        { merge: true }
      );
    });

    it('persists a reopened incident while keeping audit history', async () => {
      await reopenSystemHealthIncident({
        resolutionKey: 'u1:event-1',
        reopenedAt: '2026-05-22T14:25:00.000Z',
        actor: {
          uid: 'admin-1',
          email: 'admin@example.com',
          displayName: 'Admin User',
        },
      });

      expect(firestoreDb.setDoc).toHaveBeenCalledWith(
        'stats/system_health/resolutions',
        'u1%3Aevent-1',
        expect.objectContaining({
          resolutionKey: 'u1:event-1',
          status: 'open',
          reopenedAt: '2026-05-22T14:25:00.000Z',
          reopenedByUid: 'admin-1',
          reopenedByEmail: 'admin@example.com',
          reopenedByName: 'Admin User',
          history: [
            expect.objectContaining({
              action: 'reopened',
              at: '2026-05-22T14:25:00.000Z',
              actorUid: 'admin-1',
            }),
          ],
        }),
        { merge: true }
      );
    });

    it('normalizes subscribed resolution docs by resolution key', () => {
      const onUpdate = vi.fn();
      let capturedCallback: ((data: unknown[]) => void) | undefined;

      vi.mocked(firestoreDb.subscribeQuery).mockImplementation((path, options, callback) => {
        capturedCallback = callback as unknown as (data: unknown[]) => void;
        return vi.fn();
      });

      subscribeToSystemHealthIncidentResolutions(onUpdate);
      capturedCallback?.([
        {
          resolutionKey: 'u1:event-1',
          status: 'resolved',
          resolvedAt: '2026-05-22T14:15:00.000Z',
          resolvedByUid: 'admin-1',
          resolvedByEmail: 'admin@example.com',
          resolvedByName: 'Admin User',
          history: [{ action: 'resolved', at: '2026-05-22T14:15:00.000Z' }],
        },
        {
          resolutionKey: '',
          status: 'resolved',
        },
      ]);

      expect(firestoreDb.subscribeQuery).toHaveBeenCalledWith(
        'stats/system_health/resolutions',
        {
          orderBy: [{ field: 'updatedAt', direction: 'desc' }],
          limit: 300,
        },
        expect.any(Function)
      );
      expect(onUpdate).toHaveBeenCalledWith({
        'u1:event-1': expect.objectContaining({
          status: 'resolved',
          resolvedAt: '2026-05-22T14:15:00.000Z',
          resolvedByEmail: 'admin@example.com',
          history: [
            expect.objectContaining({
              action: 'resolved',
              at: '2026-05-22T14:15:00.000Z',
            }),
          ],
        }),
      });
    });
  });

  describe('getSystemHealthSnapshot', () => {
    it('should fetch user health docs from db', async () => {
      const mockUsers: UserHealthStatus[] = [
        { ...mockStatus, uid: 'user1' },
        { ...mockStatus, uid: 'user2' },
      ];
      vi.mocked(firestoreDb.getDocs).mockResolvedValueOnce(mockUsers);

      const results = await getSystemHealthSnapshot();
      expect(results).toHaveLength(2);
      expect(results[0].uid).toBe('user1');
    });

    it('should handle fetch errors and return empty array', async () => {
      vi.mocked(firestoreDb.getDocs).mockRejectedValueOnce(new Error('Fetch Failed'));
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const results = await getSystemHealthSnapshot();
      expect(results).toEqual([]);
      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    it('normalizes partial docs when fetching snapshot', async () => {
      vi.mocked(firestoreDb.getDocs).mockResolvedValueOnce([
        { uid: 'u1', email: '', pendingMutations: '3' as unknown as number },
      ]);

      const results = await getSystemHealthSnapshot();
      expect(results[0].uid).toBe('u1');
      expect(results[0].email).toBe('unknown@local');
      expect(results[0].pendingMutations).toBe(3);
      expect(results[0].displayName).toBe('Usuario sin nombre');
      expect(results[0].syncOrphanedTasks).toBe(0);
    });
  });

  describe('subscribeToSystemHealth', () => {
    it('should call db.subscribeQuery and return unsubscribe function', () => {
      const onUpdate = vi.fn();
      const unsubscribeMock = vi.fn();
      vi.mocked(firestoreDb.subscribeQuery).mockReturnValueOnce(unsubscribeMock);

      const result = subscribeToSystemHealth(onUpdate);
      expect(firestoreDb.subscribeQuery).toHaveBeenCalled();
      expect(result).toBe(unsubscribeMock);
    });

    it('should trigger onUpdate when db provides data', () => {
      const onUpdate = vi.fn();
      let capturedCallback: ((data: unknown[]) => void) | undefined;

      vi.mocked(firestoreDb.subscribeQuery).mockImplementation((path, options, callback) => {
        capturedCallback = callback as unknown as (data: unknown[]) => void;
        return vi.fn();
      });

      subscribeToSystemHealth(onUpdate);

      // Simulate data update
      const mockData: Partial<UserHealthStatus>[] = [{ uid: 'u1' }];
      capturedCallback?.(mockData);

      expect(onUpdate).toHaveBeenCalledWith([
        expect.objectContaining({
          uid: 'u1',
          email: 'unknown@local',
        }),
      ]);
    });
  });

  describe('normalizeUserHealthStatus', () => {
    it('fills defaults for empty/invalid payloads', () => {
      const normalized = normalizeUserHealthStatus({
        uid: '',
        email: '',
        pendingMutations: Number.NaN,
      });

      expect(normalized.uid).toBe('unknown');
      expect(normalized.email).toBe('unknown@local');
      expect(normalized.pendingMutations).toBe(0);
      expect(normalized.isOnline).toBe(false);
      expect(normalized.operationalObservedCount).toBe(0);
      expect(normalized.operationalBlockedCount).toBe(0);
      expect(normalized.operationalSyncObservedCount).toBe(0);
      expect(normalized.operationalTopObservedOperation).toBeUndefined();
      expect(normalized.remoteSyncReason).toBeUndefined();
      expect(normalized.versionUpdateReason).toBeUndefined();
    });
  });

  describe('buildSystemHealthSummary', () => {
    it('aggregates operational health totals', () => {
      const summary = buildSystemHealthSummary([
        mockStatus,
        {
          ...mockStatus,
          uid: 'u2',
          isOnline: false,
          degradedLocalPersistence: true,
          failedSyncTasks: 2,
          conflictSyncTasks: 1,
          syncOrphanedTasks: 2,
          versionUpdateReason: 'runtime_contract_mismatch',
          localErrorCount: 3,
          repositoryWarningCount: 4,
          slowestRepositoryOperationMs: 280,
          operationalObservedCount: 5,
          operationalFailureCount: 2,
          operationalRetryableCount: 1,
          operationalRecoverableCount: 1,
          operationalDegradedCount: 1,
          operationalBlockedCount: 1,
          operationalUnauthorizedCount: 1,
          operationalLastHourObservedCount: 3,
          operationalSyncObservedCount: 2,
          operationalIndexedDbObservedCount: 1,
          operationalClinicalDocumentObservedCount: 1,
          operationalCreateDayObservedCount: 1,
          operationalHandoffObservedCount: 2,
          operationalExportBackupObservedCount: 3,
          operationalDailyRecordRecoveredRealtimeNullCount: 1,
          operationalDailyRecordConfirmedRealtimeNullCount: 1,
          operationalSyncReadUnavailableCount: 1,
          operationalIndexedDbFallbackModeCount: 1,
          operationalAuthBootstrapTimeoutCount: 1,
          operationalTopObservedCategory: 'backup',
          operationalTopObservedOperation: 'backup_handoff_pdf',
          latestOperationalOperation: 'backup_handoff_pdf',
          latestOperationalRuntimeState: 'recoverable',
        },
      ]);

      expect(summary.totalUsers).toBe(2);
      expect(summary.offlineUsers).toBe(1);
      expect(summary.degradedLocalPersistenceUsers).toBe(1);
      expect(summary.usersWithSyncFailures).toBe(1);
      expect(summary.usersWithRepositoryWarnings).toBe(1);
      expect(summary.totalFailedSyncTasks).toBe(2);
      expect(summary.totalConflictSyncTasks).toBe(1);
      expect(summary.totalSyncOrphanedTasks).toBe(2);
      expect(summary.totalRepositoryWarnings).toBe(4);
      expect(summary.maxSlowRepositoryOperationMs).toBe(280);
      expect(summary.oldestObservedPendingAgeMs).toBe(0);
      expect(summary.totalOperationalObservedCount).toBe(5);
      expect(summary.totalOperationalFailureCount).toBe(2);
      expect(summary.totalOperationalRetryableCount).toBe(1);
      expect(summary.totalOperationalRecoverableCount).toBe(1);
      expect(summary.totalOperationalDegradedCount).toBe(1);
      expect(summary.totalOperationalBlockedCount).toBe(1);
      expect(summary.totalOperationalUnauthorizedCount).toBe(1);
      expect(summary.totalOperationalLastHourObservedCount).toBe(3);
      expect(summary.totalOperationalSyncObservedCount).toBe(2);
      expect(summary.totalOperationalIndexedDbObservedCount).toBe(1);
      expect(summary.totalOperationalClinicalDocumentObservedCount).toBe(1);
      expect(summary.totalOperationalCreateDayObservedCount).toBe(1);
      expect(summary.totalOperationalHandoffObservedCount).toBe(2);
      expect(summary.totalOperationalExportBackupObservedCount).toBe(3);
      expect(summary.totalOperationalDailyRecordRecoveredRealtimeNullCount).toBe(1);
      expect(summary.totalOperationalDailyRecordConfirmedRealtimeNullCount).toBe(1);
      expect(summary.totalOperationalSyncReadUnavailableCount).toBe(1);
      expect(summary.totalOperationalIndexedDbFallbackModeCount).toBe(1);
      expect(summary.totalOperationalAuthBootstrapTimeoutCount).toBe(1);
      expect(summary.usersWithSyncOwnershipDrift).toBe(1);
      expect(summary.usersWithRuntimeContractMismatch).toBe(1);
      expect(summary.usersWithSchemaAheadClient).toBe(0);
      expect(summary.topOperationalCategory).toBe('backup');
      expect(summary.topOperationalOperation).toBe('backup_handoff_pdf');
      expect(summary.topOperationalRuntimeState).toBe('recoverable');
      expect(summary.usersWithRecentOperationalIssues).toBe(0);
      expect(summary.latestOperationalIssueAt).toBeUndefined();
    });

    it('tracks recent operational issue metadata', () => {
      const summary = buildSystemHealthSummary([
        {
          ...mockStatus,
          latestOperationalIssueAt: '2026-02-19T08:00:00.000Z',
        },
        {
          ...mockStatus,
          uid: 'u2',
          latestOperationalIssueAt: '2026-02-19T10:15:00.000Z',
        },
      ]);

      expect(summary.usersWithRecentOperationalIssues).toBe(2);
      expect(summary.latestOperationalIssueAt).toBe('2026-02-19T10:15:00.000Z');
    });
  });
});
