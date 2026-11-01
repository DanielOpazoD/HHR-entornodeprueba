import { ensureDbReady, hospitalDB } from '@/services/storage/indexeddb/indexedDbCore';
import { getStoredSessionOwnerKey } from '@/services/storage/sessionOwnerKey';
import {
  getSessionGeneration,
  SESSION_GENERATION_KEY,
} from '@/services/storage/sessionStorageTransition';
import { clearSyncTaskRuntimeState } from './syncQueueTaskFactory';
import { hasPendingNursingHandoff } from './nursingHandoffTasks';
import { downloadBlob } from '@/services/exporters/exportDownload';
import { serializeDailyRecordTaskBackup } from './dailyRecordTaskRetirement';

const captureSession = (owner: string) => {
  const generation = getSessionGeneration();
  return () => {
    if (
      !generation ||
      owner !== getStoredSessionOwnerKey() ||
      generation !== getSessionGeneration() ||
      generation !== localStorage.getItem(SESSION_GENERATION_KEY)
    )
      throw new Error('La sesión cambió.');
  };
};

const ownedPending = async (owner: string) =>
  hospitalDB.syncQueue
    .where('[ownerKey+status]')
    .anyOf(['PENDING', 'PROCESSING', 'FAILED', 'CONFLICT'].map(status => [owner, status]))
    .filter(hasPendingNursingHandoff)
    .toArray();

const requireQueue = async () => {
  await ensureDbReady();
  if (hospitalDB.syncQueue.db !== hospitalDB) throw new Error('La cola local no está disponible.');
};

/** Ten seconds includes loading, local reads and hung transport. An abort stops later sends. */
export const attemptNursingHandoffLogout = async (
  owner: string,
  label: string,
  signal?: AbortSignal
): Promise<boolean> => {
  const assertSession = captureSession(owner);
  const abort = new AbortController();
  const cancel = () => abort.abort();
  signal?.addEventListener('abort', cancel, { once: true });
  if (signal?.aborted) abort.abort();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const attempt = async () => {
    await requireQueue();
    assertSession();
    const tasks = await ownedPending(owner);
    assertSession();
    if (abort.signal.aborted) return false;
    if (!tasks.length) return true;
    await hospitalDB.transaction('rw', hospitalDB.syncQueue, async () => {
      assertSession();
      if (abort.signal.aborted) return;
      for (const task of await ownedPending(owner)) {
        if (task.id !== undefined)
          await hospitalDB.syncQueue.update(task.id, {
            nursingHandoffOwnerLabel: label,
            ...(task.status === 'PENDING' && !task.preOutboxHoldState ? { nextAttemptAt: 0 } : {}),
            ...(task.status === 'FAILED' &&
            task.lastErrorCategory === 'network' &&
            !task.projectionReleased
              ? clearSyncTaskRuntimeState()
              : {}),
          });
      }
    });
    if (!navigator.onLine || abort.signal.aborted) return false;
    const { processSyncQueue } = await import('./publicSyncQueue');
    while (!abort.signal.aborted) {
      assertSession();
      // A busy worker may already own this send; its row must actually leave the queue.
      void processSyncQueue({ nursingHandoffOnly: true, signal: abort.signal });
      const remaining = await ownedPending(owner);
      assertSession();
      if (!remaining.length) return true;
      if (remaining.every(task => task.status === 'FAILED' || task.status === 'CONFLICT'))
        return false;
      await new Promise<void>(resolve => {
        const wait = setTimeout(done, 100);
        function done() {
          clearTimeout(wait);
          abort.signal.removeEventListener('abort', done);
          resolve();
        }
        abort.signal.addEventListener('abort', done, { once: true });
      });
    }
    return false;
  };
  try {
    return await Promise.race([
      attempt().catch(() => false),
      new Promise<boolean>(resolve => {
        timer = setTimeout(() => {
          abort.abort();
          resolve(false);
        }, 10_000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', cancel);
    abort.abort();
  }
};

/** Only the original admitted owner can revive its logout-held nursing fields. */
export const resumeOwnedNursingHandoff = async (owner: string): Promise<string[]> => {
  const assertSession = captureSession(owner);
  await requireQueue();
  let resumed = false;
  const labels = await hospitalDB.transaction('rw', hospitalDB.syncQueue, async () => {
    assertSession();
    const foreign = new Set<string>();
    const tasks = await hospitalDB.syncQueue
      .where('status')
      .notEqual('RETIRED')
      .filter(hasPendingNursingHandoff)
      .toArray();
    for (const task of tasks) {
      if (
        task.ownerKey === owner &&
        task.status === 'FAILED' &&
        (task.lastErrorCode === 'session_owner_logged_out' ||
          (task.projectionReleased && task.lastErrorCategory === 'network'))
      ) {
        if (task.id !== undefined) {
          await hospitalDB.syncQueue.update(task.id, {
            ...clearSyncTaskRuntimeState(),
            retryCount: 0,
            nursingHandoffRecovery: true,
            projectionReleased: true,
          });
          resumed = true;
        }
      } else if (
        task.ownerKey &&
        task.ownerKey !== owner &&
        !task.ownerKey.startsWith('unattributed:') &&
        (task.projectionReleased || task.lastErrorCode === 'session_owner_logged_out')
      ) {
        foreign.add(task.nursingHandoffOwnerLabel || task.ownerKey.replace(/^user:/, 'usuario '));
      }
    }
    assertSession();
    return [...foreign];
  });
  assertSession();
  if (resumed) {
    const { processSyncQueue } = await import('./publicSyncQueue');
    assertSession();
    if (navigator.onLine) void processSyncQueue({ nursingHandoffOnly: true });
  }
  return labels;
};

/** Same backup envelope and download mechanism as the existing review, without retiring work. */
export const downloadPendingNursingHandoff = async (owner: string): Promise<void> => {
  const assertSession = captureSession(owner);
  await requireQueue();
  const tasks = await ownedPending(owner);
  assertSession();
  for (const task of tasks) {
    downloadBlob(
      new Blob([serializeDailyRecordTaskBackup(task)], { type: 'application/json' }),
      `hhr-envio-local-${task.id}.json`
    );
  }
};
