import type { SyncTask } from '@/services/storage/syncQueueTypes';
import type { DailyRecord } from '@/services/storage/storageDailyRecordContracts';
import type { PendingDailyRecordSyncTaskIdentity } from '@/services/storage/sync/pendingDailyRecordSyncTask';

export type SyncQueueTaskWriteMode = 'created' | 'reused';

export interface SyncQueueLeaseClaim {
  leaseOwner: string;
  leaseUntil: number;
  attemptId: string;
}

export interface DailyRecordAuthorityAdoptionResult {
  status: 'adopted' | 'replaced' | 'blocked';
  record?: DailyRecord;
}

/** What is pending for a day: its local projection and the paths its unresolved write owns. */
export interface PendingDailyRecordProjection {
  projection: DailyRecord;
  pendingChangedPaths: string[];
}

/**
 * Runs inside the enqueue transaction. Returns the write applied on top of the pending
 * projection, or null when the write already carries that pending work. Throws to reject it.
 */
export type DailyRecordPendingProjectionRebase = (
  pending: PendingDailyRecordProjection
) => DailyRecord | null;

export interface SyncQueueStorePort {
  /** Serialize standalone capacity checks and writes in the same storage transaction. */
  withEnqueueTransaction?<T>(operation: () => Promise<T>): Promise<T>;
  listAll(ownerKey?: string | null): Promise<SyncTask[]>;
  listRecent(limit: number, ownerKey?: string | null): Promise<SyncTask[]>;
  claimReadyPending(
    now: number,
    limit: number,
    ownerKey: string | null | undefined,
    claim: SyncQueueLeaseClaim
  ): Promise<SyncTask[]>;
  findReusableTask(
    type: SyncTask['type'],
    key: string,
    ownerKey?: string | null
  ): Promise<SyncTask | null>;
  add(task: SyncTask): Promise<void>;
  saveDailyRecordWithTask(
    record: DailyRecord,
    task: SyncTask,
    rebaseOntoPendingProjection?: DailyRecordPendingProjectionRebase
  ): Promise<SyncQueueTaskWriteMode>;
  /** Atomically replace an existing pending daily-record task; never creates a second task. */
  replacePendingDailyRecordWithTask?(
    record: DailyRecord,
    task: SyncTask,
    expectedTask?: PendingDailyRecordSyncTaskIdentity
  ): Promise<boolean>;
  /**
   * Atomically inspect every unresolved write for a date and adopt, replace or
   * supersede exactly one task. A replacement with `task: null` means the confirmed
   * command fully covered the pending work: the task is deleted in the same
   * transaction so it can never replay already-applied state.
   */
  adoptAuthoritativeDailyRecord?(
    authoritativeRecord: DailyRecord,
    ownerKey: string | null,
    buildReplacement: (
      localRecord: DailyRecord,
      pendingTask: SyncTask
    ) => { record: DailyRecord; task: SyncTask | null } | null
  ): Promise<DailyRecordAuthorityAdoptionResult>;
  deletePendingByKey(
    type: SyncTask['type'],
    key: string,
    ownerKey?: string | null,
    mutationId?: string
  ): Promise<boolean>;
  releasePreOutboxHoldByKey(
    type: SyncTask['type'],
    key: string,
    ownerKey?: string | null,
    mutationId?: string
  ): Promise<boolean>;
  renewPreOutboxHoldByKey(
    type: SyncTask['type'],
    key: string,
    ownerKey: string | null | undefined,
    mutationId: string | undefined,
    holdOwner: string,
    now: number,
    holdForMs: number
  ): Promise<boolean>;
  /** Revive una tarea FAILED/CONFLICT como PENDING limpia (acción explícita del usuario). */
  requeueQuarantinedTask?(taskId: number, ownerKey?: string | null): Promise<boolean>;
  /** Elimina una tarea FAILED/CONFLICT; nunca toca tareas activas (acción explícita del usuario). */
  discardQuarantinedTask?(taskId: number, ownerKey?: string | null): Promise<boolean>;
  update(taskId: number, patch: Partial<SyncTask>): Promise<void>;
  updateClaimed(
    taskId: number,
    patch: Partial<SyncTask>,
    claim: SyncQueueLeaseClaim
  ): Promise<boolean>;
  delete(taskId: number): Promise<void>;
  /** Complete the claim and optionally adopt its ACK without replacing unresolved projections. */
  deleteClaimed(
    taskId: number,
    claim: SyncQueueLeaseClaim,
    authoritativeRecord?: DailyRecord
  ): Promise<boolean>;
  deleteAll(): Promise<void>;
  deleteByOwner(ownerKey: string | null): Promise<void>;
  countForeign(ownerKey: string | null): Promise<number>;
}

export interface SyncRuntimePort {
  isOnline(): boolean;
  onOnline(callback: () => void): void;
  getOwnerKey(): string | null;
}

export interface SyncTransportPort {
  run(task: SyncTask): Promise<SyncTransportResult | void>;
}

export interface SyncTransportResult {
  authoritativeRecord: DailyRecord;
}
