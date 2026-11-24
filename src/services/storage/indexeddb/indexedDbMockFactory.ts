import type { IndexableType, TransactionMode } from 'dexie';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { AuditLogEntry } from '@/types/auditLogTypes';
import type { ErrorLog } from '@/services/logging/errorLogTypes';
import type { SyncTask } from '@/services/storage/syncQueueTypes';
import type { CatalogRecord } from '@/services/storage/indexeddb/indexedDbCatalogContracts';
import type {
  IndexedDbDatabaseLike,
  IndexedDbFilteredCollectionLike,
  IndexedDbModifySpec,
  IndexedDbTableLike,
  IndexedDbTransactionTableArg,
  IndexedDbWhereCollectionLike,
} from '@/services/storage/indexeddb/indexedDbContracts';

const compareValues = (a: unknown, b: unknown): number => {
  if (a === b) return 0;
  if (a === undefined || a === null) return -1;
  if (b === undefined || b === null) return 1;
  if (Array.isArray(a) && Array.isArray(b)) {
    const maxLen = Math.max(a.length, b.length);
    for (let index = 0; index < maxLen; index += 1) {
      const diff = compareValues(a.at(index), b.at(index));
      if (diff !== 0) return diff;
    }
    return 0;
  }
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b));
};

const readField = (item: object, keyPath: string): unknown => {
  if (keyPath.startsWith('[') && keyPath.endsWith(']')) {
    return keyPath
      .slice(1, -1)
      .split('+')
      .map(field =>
        Object.prototype.hasOwnProperty.call(item, field) ? Reflect.get(item, field) : undefined
      );
  }
  return Object.prototype.hasOwnProperty.call(item, keyPath)
    ? Reflect.get(item, keyPath)
    : undefined;
};

interface MockTableConfig<TItem extends object, TKey extends string | number> {
  name: string;
  getKey: (item: TItem) => TKey;
  prepareOnAdd?: (item: TItem) => TItem;
}

const createMockTable = <TItem extends object, TKey extends string | number>({
  name,
  getKey,
  prepareOnAdd,
}: MockTableConfig<TItem, TKey>): IndexedDbTableLike<TItem, TKey> => {
  const store = new Map<TKey, TItem>();

  const getSortedEntries = (keyPath: string): Array<[TKey, TItem]> =>
    Array.from(store.entries()).sort(([, a], [, b]) =>
      compareValues(readField(a, keyPath), readField(b, keyPath))
    );

  const deleteMatching = (predicate: (item: TItem) => boolean): Promise<number> => {
    let removed = 0;
    for (const [key, item] of store.entries()) {
      if (predicate(item)) {
        store.delete(key);
        removed += 1;
      }
    }
    return Promise.resolve(removed);
  };

  const modifyEntries = (
    entries: Array<[TKey, TItem]>,
    changes: IndexedDbModifySpec<TItem>
  ): Promise<number> => {
    let modified = 0;
    for (const [key, item] of entries) {
      if (typeof changes === 'function') {
        const ctx = { value: item };
        const result = changes(item, ctx);
        if (result === false) {
          store.delete(key);
        } else if (ctx.value !== item) {
          store.set(key, ctx.value);
        }
      } else {
        Object.assign(item, changes);
      }
      modified += 1;
    }
    return Promise.resolve(modified);
  };

  const buildFiltered = (
    getEntries: () => Array<[TKey, TItem]>,
    predicate: (item: TItem) => boolean
  ): IndexedDbFilteredCollectionLike<TItem> => {
    const matchedEntries = () => getEntries().filter(([, item]) => predicate(item));
    return {
      toArray: () => Promise.resolve(matchedEntries().map(([, item]) => item)),
      count: () => Promise.resolve(matchedEntries().length),
      limit: (n: number) => ({
        toArray: () =>
          Promise.resolve(
            matchedEntries()
              .slice(0, n)
              .map(([, item]) => item)
          ),
      }),
      delete: () =>
        deleteMatching(item => matchedEntries().some(([, matched]) => matched === item)),
      modify: (changes: IndexedDbModifySpec<TItem>) => modifyEntries(matchedEntries(), changes),
    };
  };

  const buildWhereCollection = (
    getEntries: () => Array<[TKey, TItem]>,
    indexKeyPath?: string
  ): IndexedDbWhereCollectionLike<TItem> => ({
    first: () => Promise.resolve(getEntries().at(0)?.[1]),
    count: () => Promise.resolve(getEntries().length),
    toArray: () => Promise.resolve(getEntries().map(([, item]) => item)),
    uniqueKeys: () => {
      const seen = new Set<string>();
      const unique: Array<string | number> = [];
      for (const [key, item] of getEntries()) {
        const raw = indexKeyPath ? readField(item, indexKeyPath) : key;
        if (typeof raw === 'string' || typeof raw === 'number') {
          const token = `${typeof raw}:${String(raw)}`;
          if (!seen.has(token)) {
            seen.add(token);
            unique.push(raw);
          }
        }
      }
      return Promise.resolve(unique);
    },
    sortBy: (sortKey: string) =>
      Promise.resolve(
        getEntries()
          .map(([, item]) => item)
          .sort((a, b) => compareValues(readField(a, sortKey), readField(b, sortKey)))
      ),
    delete: () => {
      const entries = getEntries();
      for (const [key] of entries) {
        store.delete(key);
      }
      return Promise.resolve(entries.length);
    },
    modify: (changes: IndexedDbModifySpec<TItem>) => modifyEntries(getEntries(), changes),
    filter: (predicate: (item: TItem) => boolean) => buildFiltered(getEntries, predicate),
    reverse: () => {
      const reversed = () => [...getEntries()].reverse();
      return {
        toArray: () => Promise.resolve(reversed().map(([, item]) => item)),
        count: () => Promise.resolve(reversed().length),
        limit: (n: number) => ({
          toArray: () =>
            Promise.resolve(
              reversed()
                .slice(0, n)
                .map(([, item]) => item)
            ),
        }),
        keys: () => Promise.resolve(reversed().map(([key]) => key)),
        first: () => Promise.resolve(reversed().at(0)?.[1]),
        filter: (predicate: (item: TItem) => boolean) => buildFiltered(reversed, predicate),
      };
    },
  });

  const addItem = (item: TItem): TKey => {
    const prepared = prepareOnAdd ? prepareOnAdd(item) : item;
    const key = getKey(prepared);
    store.set(key, prepared);
    return key;
  };

  function bulkAdd<B extends boolean>(
    items: readonly TItem[],
    options: { allKeys: B }
  ): Promise<B extends true ? TKey[] : TKey>;
  function bulkAdd(items: readonly TItem[]): Promise<TKey>;
  function bulkAdd(
    items: readonly TItem[],
    options?: { allKeys?: boolean }
  ): Promise<TKey | TKey[]> {
    const keys = items.map(item => addItem(item));
    if (options?.allKeys) {
      return Promise.resolve(keys);
    }
    const lastKey = keys.at(-1);
    return Promise.resolve(lastKey as TKey);
  }

  return {
    name,
    toArray: () => Promise.resolve(Array.from(store.values())),
    toCollection: () => buildWhereCollection(() => Array.from(store.entries())),
    get: (key: TKey) => Promise.resolve(store.get(key)),
    put: (item: TItem) => {
      const key = getKey(item);
      store.set(key, item);
      return Promise.resolve(key);
    },
    delete: (key: TKey) => {
      store.delete(key);
      return Promise.resolve();
    },
    clear: () => {
      store.clear();
      return Promise.resolve();
    },
    count: () => Promise.resolve(store.size),
    bulkAdd,
    bulkPut: (items: readonly TItem[]) => {
      items.forEach(item => {
        store.set(getKey(item), item);
      });
      return Promise.resolve('');
    },
    update: (id: TKey, changes: Partial<TItem>) => {
      const existing = store.get(id);
      if (existing) {
        Object.assign(existing, changes);
      }
      return Promise.resolve(existing ? 1 : 0);
    },
    add: (item: TItem) => Promise.resolve(addItem(item)),
    filter: (predicate: (item: TItem) => boolean) =>
      buildFiltered(() => Array.from(store.entries()), predicate),
    orderBy: (keyPath: string) => ({
      reverse: () => {
        const reversedEntries = () => getSortedEntries(keyPath).reverse();
        return {
          limit: (n: number) => ({
            toArray: () =>
              Promise.resolve(
                reversedEntries()
                  .slice(0, n)
                  .map(([, value]) => value)
              ),
          }),
          keys: () => Promise.resolve(reversedEntries().map(([key]) => key)),
          first: () => Promise.resolve(reversedEntries().at(0)?.[1]),
          count: () => Promise.resolve(reversedEntries().length),
          toArray: () => Promise.resolve(reversedEntries().map(([, value]) => value)),
          filter: (predicate: (item: TItem) => boolean) =>
            buildFiltered(reversedEntries, predicate),
        };
      },
      count: () => Promise.resolve(store.size),
      toArray: () => Promise.resolve(getSortedEntries(keyPath).map(([, value]) => value)),
    }),
    where: (keyName: string) => ({
      below: (val: IndexableType) => ({
        reverse: () => ({
          first: () => {
            const sortedKeys = Array.from(store.keys()).sort(compareValues);
            const targetKey = sortedKeys.reverse().find(k => compareValues(k, val) < 0);
            return Promise.resolve(targetKey !== undefined ? store.get(targetKey) : undefined);
          },
        }),
      }),
      equals: (val: IndexableType) =>
        buildWhereCollection(
          () =>
            Array.from(store.entries()).filter(
              ([, item]) => compareValues(readField(item, keyName), val) === 0
            ),
          keyName
        ),
      notEqual: (val: IndexableType) =>
        buildWhereCollection(
          () =>
            Array.from(store.entries()).filter(
              ([, item]) => compareValues(readField(item, keyName), val) !== 0
            ),
          keyName
        ),
      anyOf: (values: ReadonlyArray<IndexableType>) =>
        buildWhereCollection(
          () =>
            Array.from(store.entries()).filter(([, item]) =>
              values.some(candidate => compareValues(readField(item, keyName), candidate) === 0)
            ),
          keyName
        ),
      startsWith: (prefix: string) => {
        const matching = () =>
          Array.from(store.values()).filter(item =>
            String(readField(item, keyName) ?? '').startsWith(prefix)
          );
        return {
          toArray: () => Promise.resolve(matching()),
          count: () => Promise.resolve(matching().length),
        };
      },
      between: (
        lower: IndexableType,
        upper: IndexableType,
        includeLower = true,
        includeUpper = false
      ) =>
        buildWhereCollection(
          () =>
            getSortedEntries(keyName).filter(([, item]) => {
              const value = readField(item, keyName);
              const lowerCmp = compareValues(value, lower);
              const upperCmp = compareValues(value, upper);
              return (
                (includeLower ? lowerCmp >= 0 : lowerCmp > 0) &&
                (includeUpper ? upperCmp <= 0 : upperCmp < 0)
              );
            }),
          keyName
        ),
    }),
  };
};

export const createMockDatabase = (): IndexedDbDatabaseLike => {
  let nextSyncTaskId = 1;

  const runTransaction: IndexedDbDatabaseLike['transaction'] = async <TResult>(
    _mode: TransactionMode,
    ...args: [
      ...Array<IndexedDbTransactionTableArg | readonly IndexedDbTransactionTableArg[]>,
      () => PromiseLike<TResult> | TResult,
    ]
  ): Promise<TResult> => {
    const scope = args.at(-1);
    if (typeof scope !== 'function') {
      throw new TypeError('Mock IndexedDB transaction requires a scope callback.');
    }
    return await scope();
  };

  return {
    dailyRecords: createMockTable<DailyRecord, string>({
      name: 'dailyRecords',
      getKey: item => item.date || 'default',
    }),
    catalogs: createMockTable<CatalogRecord, string>({
      name: 'catalogs',
      getKey: item => item.id || 'default',
    }),
    errorLogs: createMockTable<ErrorLog, string>({
      name: 'errorLogs',
      getKey: item => item.id || 'default',
      prepareOnAdd: item => (item.id ? item : { ...item, id: Math.random().toString() }),
    }),
    auditLogs: createMockTable<AuditLogEntry, string>({
      name: 'auditLogs',
      getKey: item => item.id || 'default',
      prepareOnAdd: item => (item.id ? item : { ...item, id: Math.random().toString() }),
    }),
    settings: createMockTable<{ id: string; value: unknown }, string>({
      name: 'settings',
      getKey: item => item.id || 'default',
    }),
    syncQueue: createMockTable<SyncTask, number>({
      name: 'syncQueue',
      getKey: item => {
        if (typeof item.id === 'number') {
          if (item.id >= nextSyncTaskId) nextSyncTaskId = item.id + 1;
          return item.id;
        }
        const assigned = nextSyncTaskId;
        nextSyncTaskId += 1;
        return assigned;
      },
      prepareOnAdd: item => {
        if (typeof item.id === 'number') {
          return item;
        }
        const id = nextSyncTaskId;
        nextSyncTaskId += 1;
        return { ...item, id };
      },
    }),
    isOpen: () => true,
    open: () => Promise.resolve(),
    close: () => undefined,
    delete: () => Promise.resolve(),
    on: () => ({}),
    transaction: runTransaction,
  };
};
