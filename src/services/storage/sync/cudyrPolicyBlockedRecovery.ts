import type { SyncTask } from '@/services/storage/syncQueueTypes';
import type { SyncQueueStorePort } from './syncQueuePorts';

const POLICY_REJECTION = 'Clinical enrichment is not authorized by the current global policy.';
export const isPolicyBlockedCudyrArchive = (
  task: Pick<SyncTask, 'type' | 'status' | 'lastErrorCode' | 'error'>
): boolean =>
  task.type === 'ARCHIVE_CUDYR' &&
  task.status === 'FAILED' &&
  task.lastErrorCode === 'functions/failed-precondition' &&
  !!task.error?.endsWith(POLICY_REJECTION);

/** One bounded recovery per confirmed sync, never on report opening or a timer.
 * The durable outbox belongs to an authenticated owner across logins. Generation
 * guards the CURRENT asynchronous attempt; it is not a capture-expiration rule.
 */
export const createCudyrPolicyBlockedRecovery =
  (deps: {
    ensureReady: () => Promise<void>;
    store: SyncQueueStorePort;
    getOwner: () => string | null;
    getGeneration: () => string | null;
    process: () => Promise<void>;
  }) =>
  async (
    authorized: boolean,
    expectedGeneration?: string,
    isAuthorized = () => authorized
  ): Promise<number> => {
    const owner = deps.getOwner(),
      generation = deps.getGeneration();
    if (
      !authorized ||
      !isAuthorized() ||
      !owner ||
      !generation ||
      (expectedGeneration && expectedGeneration !== generation)
    )
      return 0;
    await deps.ensureReady();
    const stillOwned = () =>
      owner === deps.getOwner() && generation === deps.getGeneration() && isAuthorized();
    if (!stillOwned() || !deps.store.withEnqueueTransaction || !deps.store.requeueQuarantinedTask)
      return 0;
    const count = await deps.store.withEnqueueTransaction(async () => {
      const tasks = await deps.store.listAll(owner);
      let requeued = 0;
      for (const task of tasks
        .filter(t => t.ownerKey === owner && isPolicyBlockedCudyrArchive(t))
        .slice(0, 50)) {
        if (!stillOwned())
          throw new Error(
            'La sesión cambió o se revocó la política durante la recuperación CUDYR.'
          );
        if (task.id !== undefined && (await deps.store.requeueQuarantinedTask!(task.id, owner)))
          requeued++;
      }
      if (!stillOwned())
        throw new Error('La sesión cambió o se revocó la política durante la recuperación CUDYR.');
      return requeued;
    });
    // The normal lease/ack transport preserves observation provenance and revalidates
    // census authority at the server. No task is deleted merely because it was retried.
    if (count && stillOwned()) await deps.process();
    return count;
  };
