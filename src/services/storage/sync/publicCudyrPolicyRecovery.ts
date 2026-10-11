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
import { createMisdatedCudyrAuthorityRecovery } from './cudyrMisdatedAuthorityRecovery';

const repairMisdatedArchives = createMisdatedCudyrAuthorityRecovery({
  store: createDexieSyncQueueStore(),
  getOwner: getStoredSessionOwnerKey,
  getGeneration: getSessionGeneration,
  readConfirmedCensus: async date => {
    const snapshot = await getDocFromServer(getRecordDocRef(date));
    return snapshot.exists() ? (snapshot.data() as DailyRecord) : null;
  },
});

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

// Keep one selective dynamic import: duplicate namespace imports retain unrelated queue APIs.
async function processRecoveredArchives(): Promise<void> {
  const { processSyncQueue } = await import('./publicSyncQueue');
  await processSyncQueue();
}

const recoverPolicyBlockedArchives = createCudyrPolicyBlockedRecovery({
  ensureReady: ensureDbReady,
  store: createDexieSyncQueueStore(),
  getOwner: getStoredSessionOwnerKey,
  getGeneration: getSessionGeneration,
  process: processRecoveredArchives,
});
export const recoverPolicyBlockedCudyrArchives = async (
  authorized: boolean,
  expectedGeneration: string,
  isAuthorized: () => boolean
): Promise<number> => {
  try {
    await ensureDbReady();
    const repaired = authorized
      ? await repairMisdatedArchives(expectedGeneration, isAuthorized)
      : 0;
    const count = await recoverPolicyBlockedArchives(authorized, expectedGeneration, isAuthorized);
    if (repaired && !count) await processRecoveredArchives();
    if (authorized && isAuthorized()) await retireObsoleteChecks(expectedGeneration, isAuthorized);
    return count + repaired;
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
