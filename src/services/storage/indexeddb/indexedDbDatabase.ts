import Dexie, { Table } from 'dexie';

import { DailyRecord } from '@/types/domain/dailyRecord';
import { AuditLogEntry } from '@/types/auditLogTypes';
import { ErrorLog } from '@/services/logging/errorLogTypes';

import { SyncTask } from '../syncQueueTypes';
import { CatalogRecord } from './indexedDbCatalogContracts';

export class HangaRoaDatabase extends Dexie {
  dailyRecords!: Table<DailyRecord>;
  catalogs!: Table<CatalogRecord>;
  errorLogs!: Table<ErrorLog>;
  auditLogs!: Table<AuditLogEntry>;
  settings!: Table<{ id: string; value: unknown }>;
  syncQueue!: Table<SyncTask>;

  constructor() {
    super('HangaRoaDB');

    this.version(8).stores({
      dailyRecords: 'date',
      catalogs: 'id',
      errorLogs: 'id, timestamp, severity',
      auditLogs: 'id, timestamp, action, entityId, recordDate',
      settings: 'id',
      syncQueue: '++id, status, timestamp, type, key, nextAttemptAt',
    });

    this.version(9).stores({
      dailyRecords: 'date, lastUpdated, dateTimestamp',
      catalogs: 'id',
      errorLogs: 'id, timestamp, severity',
      auditLogs: 'id, timestamp, action, entityId, recordDate',
      settings: 'id',
      syncQueue:
        '++id, status, timestamp, type, key, nextAttemptAt, [status+timestamp], [status+nextAttemptAt]',
    });

    this.version(10).stores({
      dailyRecords: 'date, lastUpdated, dateTimestamp',
      catalogs: 'id',
      errorLogs: 'id, timestamp, severity',
      auditLogs: 'id, timestamp, action, entityId, recordDate',
      settings: 'id',
      syncQueue:
        '++id, status, timestamp, type, key, ownerKey, nextAttemptAt, [status+timestamp], [status+nextAttemptAt], [ownerKey+status], [ownerKey+type]',
    });
  }
}
