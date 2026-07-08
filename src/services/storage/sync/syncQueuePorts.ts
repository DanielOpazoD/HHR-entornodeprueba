import type { SyncTask } from '@/services/storage/syncQueueTypes';
import type { DailyRecord } from '@/services/storage/storageDailyRecordContracts';

export type SyncQueueTaskWriteMode = 'created' | 'reused';

export interface SyncQueueLeaseClaim {
  leaseOwner: string;
  leaseUntil: number;
  attemptId: string;
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
