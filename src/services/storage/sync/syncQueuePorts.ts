import type { SyncTask } from '@/services/storage/syncQueueTypes';
import type { SyncQueueTelemetryRow } from '@/services/storage/sync/syncQueueTelemetryContracts';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { DailyRecordPatch } from '@/types/domain/dailyRecordPatch';
import type { PendingDailyRecordSyncTaskIdentity } from '@/services/storage/sync/pendingDailyRecordSyncTask';
import type { AuthoringSession } from '@/services/session/authoringSession';

/** `retained_for_owner`: the session changed first, so the task waits for its author, off the day. */
export type SyncQueueTaskWriteMode = 'created' | 'reused' | 'retained_for_owner';

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
    claim: SyncQueueLeaseClaim,
    accept?: (task: SyncTask) => boolean
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
    patchWrite: DailyRecordPatchWrite | undefined,
    wholeRecordBase: DailyRecord | undefined,
    authoringSession: AuthoringSession
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
    mutationId?: string,
    /** A confirmed direct write's fields: the base they keep in the compacted task holding it. */
    confirmedValues?: Record<string, unknown>
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
  /** Releases this owner's day sends refused after the nurse window closed; returns their days. */
  releaseClosedWindowRefusals?(
    ownerKey: string,
    now: number,
    mayRelease: () => Promise<boolean>
  ): Promise<string[]>;
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
   * Detached conflicts are written in the same transaction, so they are durable before it ends,
   * and a held part (`heldTask`) stays in the task's place instead of it leaving the queue.
   */
  deleteClaimed(
    taskId: number,
    claim: SyncQueueLeaseClaim,
    authoritativeRecord?: DailyRecord,
    detachedConflicts?: SyncTask[],
    heldTask?: Partial<SyncTask>
  ): Promise<boolean>;
  readTelemetryInputs(ownerKey: string | null): Promise<{
    rows: SyncQueueTelemetryRow[];
    foreignCount: number;
  }>;
}

export interface SyncRuntimePort {
  isOnline(): boolean;
  onOnline(callback: () => void): void;
  getOwnerKey(): string | null;
  getSessionGeneration?(): string | null;
  /** Actual authenticated actor, checked again after lazy transport loads. */
  getActorKey?(): string | null;
  /** A logout cleanup failed here, or awaits admission: queue work neither starts nor confirms. */
  isFenced?(): boolean;
  /** The owner this document admitted, held in memory: never the key another tab can replace. */
  getAdmittedOwnerKey?(): string | null;
  /** The role the server reads for this session's writes (its token claim); null without one. */
  getWriterRole?(): Promise<string | null>;
}

export interface SyncTransportPort {
  run(task: SyncTask, assertCanPublish?: () => void): Promise<SyncTransportResult | void>;
}

export interface SyncTransportResult {
  authoritativeRecord: DailyRecord;
  /** Edits for a patient who left the bed, kept as conflicts instead of being published. */
  detachedConflicts?: SyncTask[];
  /** The part of this task not published, which stays queued as it: a conflict to review. */
  heldTask?: Partial<SyncTask>;
}
