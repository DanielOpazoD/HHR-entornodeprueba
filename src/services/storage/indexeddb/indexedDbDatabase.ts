import Dexie, {
  type PromiseExtended,
  type Table,
  type TransactionMode,
  type TXWithTables,
} from 'dexie';

import { DailyRecord } from '@/types/domain/dailyRecord';
import { AuditLogEntry } from '@/types/auditLogTypes';
import { ErrorLog } from '@/services/logging/errorLogTypes';

import { SyncTask } from '../syncQueueTypes';
import { CatalogRecord } from './indexedDbCatalogContracts';
import type { IndexedDbDatabaseLike, IndexedDbTransactionTableArg } from './indexedDbContracts';

const toTableName = (table: IndexedDbTransactionTableArg): string =>
  typeof table === 'string' ? table : table.name;

const isTableArgArray = (
  entry: IndexedDbTransactionTableArg | readonly IndexedDbTransactionTableArg[]
): entry is readonly IndexedDbTransactionTableArg[] => Array.isArray(entry);

export class HangaRoaDatabase extends Dexie implements IndexedDbDatabaseLike {
  dailyRecords!: Table<DailyRecord, string>;
  catalogs!: Table<CatalogRecord, string>;
  errorLogs!: Table<ErrorLog, string>;
  auditLogs!: Table<AuditLogEntry, string>;
  settings!: Table<{ id: string; value: unknown }, string>;
  syncQueue!: Table<SyncTask, number>;

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

  override transaction<U>(
    mode: TransactionMode,
    tables: readonly IndexedDbTransactionTableArg[],
    scope: (trans: TXWithTables<this>) => PromiseLike<U> | U
  ): PromiseExtended<U>;
  override transaction<U>(
    mode: TransactionMode,
    table: IndexedDbTransactionTableArg,
    scope: (trans: TXWithTables<this>) => PromiseLike<U> | U
  ): PromiseExtended<U>;
  override transaction<U>(
    mode: TransactionMode,
    table: IndexedDbTransactionTableArg,
    table2: IndexedDbTransactionTableArg,
    scope: (trans: TXWithTables<this>) => PromiseLike<U> | U
  ): PromiseExtended<U>;
  override transaction<U>(
    mode: TransactionMode,
    table: IndexedDbTransactionTableArg,
    table2: IndexedDbTransactionTableArg,
    table3: IndexedDbTransactionTableArg,
    scope: (trans: TXWithTables<this>) => PromiseLike<U> | U
  ): PromiseExtended<U>;
  override transaction<U>(
    mode: TransactionMode,
    table: IndexedDbTransactionTableArg,
    table2: IndexedDbTransactionTableArg,
    table3: IndexedDbTransactionTableArg,
    table4: IndexedDbTransactionTableArg,
    scope: (trans: TXWithTables<this>) => PromiseLike<U> | U
  ): PromiseExtended<U>;
  override transaction<U>(
    mode: TransactionMode,
    table: IndexedDbTransactionTableArg,
    table2: IndexedDbTransactionTableArg,
    table3: IndexedDbTransactionTableArg,
    table4: IndexedDbTransactionTableArg,
    table5: IndexedDbTransactionTableArg,
    scope: (trans: TXWithTables<this>) => PromiseLike<U> | U
  ): PromiseExtended<U>;
  override transaction<U>(
    mode: TransactionMode,
    ...args: [
      ...Array<IndexedDbTransactionTableArg | readonly IndexedDbTransactionTableArg[]>,
      (trans: TXWithTables<this>) => PromiseLike<U> | U,
    ]
  ): PromiseExtended<U> {
    const scope = args.at(-1);
    if (typeof scope !== 'function') {
      throw new TypeError('IndexedDB transaction requires a scope callback.');
    }
    const tableArgs = args.slice(0, -1) as Array<
      IndexedDbTransactionTableArg | readonly IndexedDbTransactionTableArg[]
    >;
    const tableNames = tableArgs.flatMap(entry =>
      isTableArgArray(entry) ? entry.map(toTableName) : [toTableName(entry)]
    );
    return super.transaction(
      mode,
      tableNames,
      scope as (trans: TXWithTables<this>) => PromiseLike<U> | U
    );
  }
}
