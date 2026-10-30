import type { SyncTask } from '@/services/storage/syncQueueTypes';
import type { SyncQueueTelemetryRow } from '@/services/storage/sync/syncQueueTelemetryContracts';
import type { DailyRecord, DailyRecordPatch } from '@/services/storage/storageDailyRecordContracts';
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

export interface DirectDailyRecordAckInput {
  sentRecord: DailyRecord;
  confirmedRecord: DailyRecord;
  mutationId: string;
  ownerKey: string | null;
}

export type DirectDailyRecordAckResult =
  | { status: 'adopted'; record: DailyRecord }
  | { status: 'retained'; record: DailyRecord; releasedHold: boolean };

/**
 * A patch write: the record it was computed from, its patch, and how its writer prepares a
 * patched record for storage. The outbox applies it again on the day's stored record.
 */
export interface DailyRecordPatchWrite {
  baseRecord: DailyRecord;
  patch: DailyRecordPatch;
  prepare: (record: DailyRecord, patch: DailyRecordPatch) => DailyRecord;
}

export interface SyncQueueStorePort {
  completeDirectDailyRecord?(input: DirectDailyRecordAckInput): Promise<DirectDailyRecordAckResult>;
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
    patchWrite?: DailyRecordPatchWrite,
    wholeRecordBase?: DailyRecord
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
  /** Repairs pre-fix and unreleased quarantined note projections before any task replays. */
  reconcileSpecialistHandoffProjections?(): Promise<void>;
  /** Renews a claim and returns the task as stored now, or null when the claim was lost. */
  renewClaim?(
    taskId: number,
    leaseUntil: number,
    claim: SyncQueueLeaseClaim
  ): Promise<SyncTask | null>;
  update(taskId: number, patch: Partial<SyncTask>): Promise<void>;
  updateClaimed(
    taskId: number,
    patch: Partial<SyncTask>,
    claim: SyncQueueLeaseClaim
  ): Promise<boolean>;
  delete(taskId: number): Promise<void>;
  /**
   * Complete the claim and optionally adopt its ACK without replacing unresolved projections.
   * Detached conflicts are written in the same transaction, so they are durable before it ends.
   */
  deleteClaimed(
    taskId: number,
    claim: SyncQueueLeaseClaim,
    authoritativeRecord?: DailyRecord,
    detachedConflicts?: SyncTask[]
  ): Promise<boolean>;
  deleteAll(): Promise<void>;
  deleteByOwner(ownerKey: string | null): Promise<void>;
  readTelemetryInputs(ownerKey: string | null): Promise<{
    rows: SyncQueueTelemetryRow[];
    foreignCount: number;
  }>;
}

export interface SyncRuntimePort {
  isOnline(): boolean;
  onOnline(callback: () => void): void;
  getOwnerKey(): string | null;
  /** A logout cleanup failed here, or awaits admission: queue work neither starts nor confirms. */
  isFenced?(): boolean;
}

export interface SyncTransportPort {
  run(task: SyncTask): Promise<SyncTransportResult | void>;
}

export interface SyncTransportResult {
  authoritativeRecord: DailyRecord;
  /** Edits for a patient who left the bed, kept as conflicts instead of being published. */
  detachedConflicts?: SyncTask[];
}
