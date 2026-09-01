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

export interface SyncQueueStorePort {
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
  saveDailyRecordWithTask(record: DailyRecord, task: SyncTask): Promise<SyncQueueTaskWriteMode>;
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
  deleteClaimed(taskId: number, claim: SyncQueueLeaseClaim): Promise<boolean>;
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
  run(task: SyncTask): Promise<void>;
}
