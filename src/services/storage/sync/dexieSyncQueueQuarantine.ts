import { hospitalDB } from '@/services/storage/indexeddb/indexedDbCore';
import type { SyncTask } from '@/services/storage/syncQueueTypes';
import { clearSyncTaskRuntimeState } from '@/services/storage/sync/syncQueueTaskFactory';
import { requiresDailyRecordBaseReview } from '@/services/storage/sync/dailyRecordBaseReview';

/**
 * Estados de cuarentena de la cola y sus operaciones de recuperación.
 *
 * Una tarea FAILED/CONFLICT no reintenta sola (eso es lo que la hace
 * cuarentena y no un loop de píldora venenosa), pero tampoco puede quedar
 * inmortal e invisible: la revive una edición fresca del mismo registro
 * (supersedencia vía reutilización) o una acción explícita del usuario desde
 * el indicador de la barra (reintentar/descartar).
 */

export const matchesOwner = (
  ownerKey: string | null | undefined,
  taskOwnerKey?: string
): boolean => (ownerKey ? taskOwnerKey === ownerKey || !taskOwnerKey : !taskOwnerKey);

/**
 * Una edición fresca del mismo registro debe SUPERSEDER una tarea en
 * cuarentena, no convivir con ella: si solo PENDING fuera reutilizable, la
 * edición crearía una segunda tarea con la misma key y la adopción
 * autoritativa (que exige exactamente una tarea sin resolver) quedaría
 * bloqueada para siempre por la tarea envenenada. El caller de reutilización
 * escribe `clearSyncTaskRuntimeState()` (status→PENDING, errores limpios,
 * retryCount 0), así que la tarea revive con el payload nuevo. PROCESSING se
 * excluye: su lease protege el intento en vuelo.
 */
export const REUSABLE_TASK_STATES = new Set<SyncTask['status']>(['PENDING', 'FAILED', 'CONFLICT']);

const QUARANTINED_TASK_STATES = new Set<SyncTask['status']>(['FAILED', 'CONFLICT']);

/**
 * Whether a day write still holds the stored day's copy: until it is confirmed and leaves the
 * queue, retired by its owner as a backup, or released. A released one keeps only its own payload
 * for review: it never pins, absorbs or publishes the day.
 */
export const holdsDailyRecordProjection = (task: SyncTask, date: string): boolean =>
  task.type === 'UPDATE_DAILY_RECORD' &&
  task.key === `daily:${date}` &&
  !task.projectionReleased &&
  (task.status !== 'RETIRED' || task.retirement?.reason !== 'manual_discard');

/**
 * The day writes that hold the stored day, read in the caller's `rw` transaction over both tables.
 * A blocked write whose copy is already gone (a session closed by an older version) has no copy
 * left to keep: it is released here with its payload untouched, so the server's day can be read
 * and the next edit gets its own task. Any other write without its copy still fails closed.
 */
export const listDailyRecordProjectionHolders = async (date: string): Promise<SyncTask[]> => {
  const holders = (
    await hospitalDB.syncQueue.where('key').equals(`daily:${date}`).toArray()
  ).filter(task => holdsDailyRecordProjection(task, date));
  if (
    !holders.length ||
    holders.some(
      task =>
        !QUARANTINED_TASK_STATES.has(task.status) ||
        (task.payload as { date?: unknown } | null | undefined)?.date !== date
    ) ||
    (await hospitalDB.dailyRecords.get(date))
  ) {
    return holders;
  }
  for (const task of holders) {
    await hospitalDB.syncQueue.update(task.id!, { projectionReleased: true });
  }
  return [];
};

export const findReusableSyncTask = async (
  type: SyncTask['type'],
  key: string,
  ownerKey?: string | null
): Promise<SyncTask | null> =>
  (await hospitalDB.syncQueue.where('key').equals(key).toArray()).find(
    task =>
      task.type === type &&
      matchesOwner(ownerKey, task.ownerKey) &&
      REUSABLE_TASK_STATES.has(task.status) &&
      // A fresh edit lands on the stored day, which no longer holds a released task's edits.
      !task.projectionReleased
  ) || null;

/** Revive una tarea FAILED/CONFLICT como PENDING limpia (acción explícita del usuario). */
export const requeueQuarantinedTask = (
  taskId: number,
  ownerKey?: string | null
): Promise<boolean> =>
  hospitalDB.transaction('rw', hospitalDB.syncQueue, async () => {
    const task = await hospitalDB.syncQueue.get(taskId);
    if (
      !task ||
      !matchesOwner(ownerKey, task.ownerKey) ||
      !QUARANTINED_TASK_STATES.has(task.status) ||
      requiresDailyRecordBaseReview(task) ||
      // Its edits are no longer on the stored day: only a review and retirement with backup remain.
      task.projectionReleased
    ) {
      return false;
    }
    await hospitalDB.syncQueue.update(taskId, {
      retryCount: 0,
      ...clearSyncTaskRuntimeState(),
    });
    return true;
  });

/** Elimina una tarea FAILED/CONFLICT; nunca toca tareas activas (acción explícita del usuario). */
export const discardQuarantinedTask = (
  taskId: number,
  ownerKey?: string | null
): Promise<boolean> =>
  hospitalDB.transaction('rw', hospitalDB.syncQueue, async () => {
    const task = await hospitalDB.syncQueue.get(taskId);
    if (
      !task ||
      !matchesOwner(ownerKey, task.ownerKey) ||
      !QUARANTINED_TASK_STATES.has(task.status)
    ) {
      return false;
    }
    await hospitalDB.syncQueue.delete(taskId);
    return true;
  });
