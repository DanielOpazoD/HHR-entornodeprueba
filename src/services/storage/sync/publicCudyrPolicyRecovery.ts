import { createCudyrPolicyBlockedRecovery } from './cudyrPolicyBlockedRecovery';
import { createDexieSyncQueueStore } from './dexieSyncQueueStore';
import { ensureDbReady } from '@/services/storage/indexeddb/indexedDbCore';
import { getSessionGeneration } from '@/services/storage/sessionStorageTransition';
import { getStoredSessionOwnerKey } from '@/services/storage/sessionScopedStorageService';
import { recordOperationalTelemetry } from '@/services/observability/operationalTelemetryRecorder';
import { createObsoleteCudyrCaptureRecovery } from './cudyrObsoleteCaptureRecovery';
import { getDocFromServer } from 'firebase/firestore';
import { getRecordDocRef } from '@/services/storage/firestore/firestoreShared';
import type { DailyRecord } from '@/types/domain/dailyRecord';

const retireObsoleteChecks = createObsoleteCudyrCaptureRecovery({
  store: createDexieSyncQueueStore(),
  getOwner: getStoredSessionOwnerKey,
  getGeneration: getSessionGeneration,
  now: () => new Date(),
  readConfirmedCensus: async date => {
    const snapshot = await getDocFromServer(getRecordDocRef(date));
    return snapshot.exists() ? (snapshot.data() as DailyRecord) : null;
  },
});

const recoverPolicyBlockedArchives = createCudyrPolicyBlockedRecovery({
  ensureReady: ensureDbReady,
  store: createDexieSyncQueueStore(),
  getOwner: getStoredSessionOwnerKey,
  getGeneration: getSessionGeneration,
  process: async () => {
    const { processSyncQueue } = await import('./publicSyncQueue');
    await processSyncQueue();
  },
});
export const recoverPolicyBlockedCudyrArchives = async (
  authorized: boolean,
  expectedGeneration: string,
  isAuthorized: () => boolean
): Promise<number> => {
  try {
    const count = await recoverPolicyBlockedArchives(authorized, expectedGeneration, isAuthorized);
    if (authorized && isAuthorized()) await retireObsoleteChecks(expectedGeneration, isAuthorized);
    return count;
  } catch {
    recordOperationalTelemetry({
      category: 'sync',
      operation: 'cudyr_archive_recovery_failed',
      status: 'failed',
      runtimeState: 'blocked',
      issues: ['El archivo CUDYR sigue pendiente.'],
    });
    return 0;
  }
};
