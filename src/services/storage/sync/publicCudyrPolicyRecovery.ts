import { createCudyrPolicyBlockedRecovery } from './cudyrPolicyBlockedRecovery';
import { createDexieSyncQueueStore } from './dexieSyncQueueStore';
import { ensureDbReady } from '@/services/storage/indexeddb/indexedDbCore';
import {
  isAuthoringSessionCurrent,
  type AuthoringSession,
} from '@/services/storage/authoringSession';
import { recordOperationalTelemetry } from '@/services/observability/operationalTelemetryRecorder';
import { createObsoleteCudyrCaptureRecovery } from './cudyrObsoleteCaptureRecovery';
import { getDocFromServer } from 'firebase/firestore';
import { getRecordDocRef } from '@/services/storage/firestore/firestoreShared';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import { createMisdatedCudyrAuthorityRecovery } from './cudyrMisdatedAuthorityRecovery';

const repairMisdatedArchives = createMisdatedCudyrAuthorityRecovery({
  store: createDexieSyncQueueStore(),
  isSessionCurrent: isAuthoringSessionCurrent,
  readConfirmedCensus: async date => {
    const snapshot = await getDocFromServer(getRecordDocRef(date));
    return snapshot.exists() ? (snapshot.data() as DailyRecord) : null;
  },
});

const retireObsoleteChecks = createObsoleteCudyrCaptureRecovery({
  store: createDexieSyncQueueStore(),
  isSessionCurrent: isAuthoringSessionCurrent,
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
  isSessionCurrent: isAuthoringSessionCurrent,
  process: processRecoveredArchives,
});
/** `session` is the one the sync run captured when it began, before any wait. */
export const recoverPolicyBlockedCudyrArchives = async (
  authorized: boolean,
  session: AuthoringSession,
  isAuthorized: () => boolean
): Promise<number> => {
  const stillOwned = () => isAuthoringSessionCurrent(session) && isAuthorized();
  try {
    await ensureDbReady();
    const repaired = authorized ? await repairMisdatedArchives(session, isAuthorized) : 0;
    const count = await recoverPolicyBlockedArchives(authorized, session, isAuthorized);
    if (repaired && !count && stillOwned()) await processRecoveredArchives();
    if (authorized && stillOwned()) await retireObsoleteChecks(session, isAuthorized);
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
