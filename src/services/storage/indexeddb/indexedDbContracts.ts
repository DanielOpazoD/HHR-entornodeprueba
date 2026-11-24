import type { IndexableType, IndexableTypeArray, TransactionMode } from 'dexie';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { AuditLogEntry } from '@/types/auditLogTypes';
import type { ErrorLog } from '@/services/logging/errorLogTypes';
import type { SyncTask } from '@/services/storage/syncQueueTypes';
import type { CatalogRecord } from '@/services/storage/indexeddb/indexedDbCatalogContracts';

export type IndexedDbTransactionTableArg = string | { readonly name: string };

export type IndexedDbModifyCallback<TItem> = (item: TItem, ctx: { value: TItem }) => void | boolean;

export type IndexedDbModifySpec<TItem> = Partial<TItem> | IndexedDbModifyCallback<TItem>;

export interface IndexedDbFilteredCollectionLike<TItem> {
  toArray(): Promise<TItem[]>;
  count(): Promise<number>;
  limit(n: number): { toArray(): Promise<TItem[]> };
  delete(): Promise<number>;
  modify(changeCallback: IndexedDbModifyCallback<TItem>): Promise<number>;
  modify(changes: Partial<TItem>): Promise<number>;
}

export interface IndexedDbReverseCollectionLike<TItem> {
  toArray(): Promise<TItem[]>;
  count(): Promise<number>;
  limit(n: number): { toArray(): Promise<TItem[]> };
  keys(): Promise<IndexableTypeArray>;
  first(): Promise<TItem | undefined>;
  filter(predicate: (item: TItem) => boolean): IndexedDbFilteredCollectionLike<TItem>;
}

export interface IndexedDbOrderedCollectionLike<TItem> {
  toArray(): Promise<TItem[]>;
  count(): Promise<number>;
  reverse(): IndexedDbReverseCollectionLike<TItem>;
}

export interface IndexedDbWhereCollectionLike<TItem> {
  first(): Promise<TItem | undefined>;
  count(): Promise<number>;
  toArray(): Promise<TItem[]>;
  uniqueKeys(): Promise<IndexableTypeArray>;
  sortBy(keyPath: string): Promise<TItem[]>;
  delete(): Promise<number>;
  modify(changeCallback: IndexedDbModifyCallback<TItem>): Promise<number>;
  modify(changes: Partial<TItem>): Promise<number>;
  filter(predicate: (item: TItem) => boolean): IndexedDbFilteredCollectionLike<TItem>;
  reverse(): IndexedDbReverseCollectionLike<TItem>;
}

export interface IndexedDbWhereClauseLike<TItem> {
  below(upperBound: IndexableType): { reverse(): { first(): Promise<TItem | undefined> } };
  equals(value: IndexableType): IndexedDbWhereCollectionLike<TItem>;
  notEqual(value: IndexableType): IndexedDbWhereCollectionLike<TItem>;
  anyOf(values: ReadonlyArray<IndexableType>): IndexedDbWhereCollectionLike<TItem>;
  startsWith(prefix: string): {
    toArray(): Promise<TItem[]>;
    count(): Promise<number>;
  };
  between(
    lower: IndexableType,
    upper: IndexableType,
    includeLower?: boolean,
    includeUpper?: boolean
  ): IndexedDbWhereCollectionLike<TItem>;
}

export interface IndexedDbTableLike<TItem, TKey = string> {
  readonly name: string;
  /** Bound Dexie database instance; intentionally absent on the in-memory fallback. */
  readonly db?: unknown;
  toArray(): Promise<TItem[]>;
  toCollection(): IndexedDbWhereCollectionLike<TItem>;
  get(key: TKey): Promise<TItem | undefined>;
  put(item: TItem): Promise<TKey>;
  delete(key: TKey): Promise<void>;
  clear(): Promise<void>;
  count(): Promise<number>;
  bulkAdd<B extends boolean>(
    items: readonly TItem[],
    options: { allKeys: B }
  ): Promise<B extends true ? TKey[] : TKey>;
  bulkAdd(items: readonly TItem[]): Promise<TKey>;
  bulkPut(items: readonly TItem[]): Promise<unknown>;
  update(key: TKey, changes: Partial<TItem>): Promise<number>;
  add(item: TItem): Promise<TKey>;
  filter(predicate: (item: TItem) => boolean): IndexedDbFilteredCollectionLike<TItem>;
  orderBy(keyPath: string): IndexedDbOrderedCollectionLike<TItem>;
  where(keyName: string): IndexedDbWhereClauseLike<TItem>;
}

export interface IndexedDbTableMap {
  dailyRecords: IndexedDbTableLike<DailyRecord, string>;
  catalogs: IndexedDbTableLike<CatalogRecord, string>;
  errorLogs: IndexedDbTableLike<ErrorLog, string>;
  auditLogs: IndexedDbTableLike<AuditLogEntry, string>;
  settings: IndexedDbTableLike<{ id: string; value: unknown }, string>;
  syncQueue: IndexedDbTableLike<SyncTask, number>;
}

export interface IndexedDbDatabaseLike extends IndexedDbTableMap {
  isOpen(): boolean;
  open(): Promise<unknown>;
  close(closeOptions?: { disableAutoOpen: boolean }): void;
  delete(closeOptions?: { disableAutoOpen: boolean }): Promise<void>;
  on(event: 'blocked' | 'close', callback: () => void): unknown;
  transaction<TResult>(
    mode: TransactionMode,
    tables: readonly IndexedDbTransactionTableArg[],
    scope: () => PromiseLike<TResult> | TResult
  ): Promise<TResult>;
  transaction<TResult>(
    mode: TransactionMode,
    table: IndexedDbTransactionTableArg,
    scope: () => PromiseLike<TResult> | TResult
  ): Promise<TResult>;
  transaction<TResult>(
    mode: TransactionMode,
    table: IndexedDbTransactionTableArg,
    table2: IndexedDbTransactionTableArg,
    scope: () => PromiseLike<TResult> | TResult
  ): Promise<TResult>;
  transaction<TResult>(
    mode: TransactionMode,
    table: IndexedDbTransactionTableArg,
    table2: IndexedDbTransactionTableArg,
    table3: IndexedDbTransactionTableArg,
    scope: () => PromiseLike<TResult> | TResult
  ): Promise<TResult>;
}
