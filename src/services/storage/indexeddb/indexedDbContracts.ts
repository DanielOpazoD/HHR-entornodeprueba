import type { Table } from 'dexie';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { AuditLogEntry } from '@/types/auditLogTypes';
import type { ErrorLog } from '@/services/logging/errorLogTypes';
import type { SyncTask } from '@/services/storage/syncQueueTypes';
import type { CatalogRecord } from '@/services/storage/indexeddb/indexedDbCatalogContracts';

export interface IndexedDbTableMap {
  dailyRecords: Table<DailyRecord>;
  catalogs: Table<CatalogRecord>;
  errorLogs: Table<ErrorLog>;
  auditLogs: Table<AuditLogEntry>;
  settings: Table<{ id: string; value: unknown }>;
  syncQueue: Table<SyncTask>;
}

export interface IndexedDbDatabaseLike extends IndexedDbTableMap {
  isOpen(): boolean;
  open(): Promise<unknown>;
  on(...args: unknown[]): unknown;
}
