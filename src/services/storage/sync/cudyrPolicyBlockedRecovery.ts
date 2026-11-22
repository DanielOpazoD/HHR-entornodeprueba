import type { SyncTask } from '@/services/storage/syncQueueTypes';
import type { SyncQueueStorePort } from './syncQueuePorts';
import type { AuthoringSession } from '@/services/session/authoringSession';

const POLICY_REJECTION = 'Clinical enrichment is not authorized by the current global policy.';
export const isPolicyBlockedCudyrArchive = (
  task: Pick<SyncTask, 'type' | 'status' | 'lastErrorCode' | 'error'>
): boolean =>
  task.type === 'ARCHIVE_CUDYR' &&
  task.status === 'FAILED' &&
  task.lastErrorCode === 'functions/failed-precondition' &&
  !!task.error?.endsWith(POLICY_REJECTION);

/** One bounded recovery per confirmed sync, never on report opening or a timer.
 * The durable outbox belongs to an authenticated owner across logins. `session` is the one the
 * sync run captured when it began: only that person's tasks are revived, and nothing is revived or
 * processed once this browser holds someone else or a logout began (the rows stay as they were).
 */
export const createCudyrPolicyBlockedRecovery =
  (deps: {
    ensureReady: () => Promise<void>;
    store: SyncQueueStorePort;
    isSessionCurrent: (session: AuthoringSession) => boolean;
    process: () => Promise<void>;
  }) =>
  async (
    authorized: boolean,
    session: AuthoringSession,
    isAuthorized = () => authorized
  ): Promise<number> => {
    const owner = session.ownerKey;
    const stillOwned = () => deps.isSessionCurrent(session) && isAuthorized();
    if (!authorized || !owner || !session.generation || !stillOwned()) return 0;
    await deps.ensureReady();
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
