import type { IndexedDbDatabaseLike } from '@/services/storage/indexeddb/indexedDbContracts';

export const createMockDatabase = (): IndexedDbDatabaseLike => {
  const memoryStore: Record<string, Map<string, unknown>> = {
    dailyRecords: new Map<string, unknown>(),
    catalogs: new Map<string, unknown>(),
    errorLogs: new Map<string, unknown>(),
    auditLogs: new Map<string, unknown>(),
    settings: new Map<string, unknown>(),
    syncQueue: new Map<string, unknown>(),
  };

  const createMockTable = (tableName: string) => ({
    toArray: () => Promise.resolve(Array.from(memoryStore[tableName].values())),
    get: (key: string) => Promise.resolve(memoryStore[tableName].get(key) || null),
    put: (item: Record<string, unknown>) => {
      const key = (item.date as string) || (item.id as string) || 'default';
      memoryStore[tableName].set(key, item);
      return Promise.resolve(key);
    },
    delete: (key: string) => {
      memoryStore[tableName].delete(key);
      return Promise.resolve();
    },
    clear: () => {
      memoryStore[tableName].clear();
      return Promise.resolve();
    },
    bulkPut: (items: Record<string, unknown>[]) => {
      items.forEach(item => {
        const key = (item.date as string) || (item.id as string) || 'default';
        memoryStore[tableName].set(key, item);
      });
      return Promise.resolve('');
    },
    update: (id: string, changes: Record<string, unknown>) => {
      const existing = Array.from(memoryStore[tableName].values()).find(item => {
        const currentItem = item as Record<string, unknown>;
        return (currentItem.id || currentItem.date) === id;
      }) as Record<string, unknown> | undefined;

      if (existing) {
        Object.assign(existing, changes);
      }

      return Promise.resolve(existing ? 1 : 0);
    },
    add: (item: Record<string, unknown>) => {
      const id = (item.id as string) || Math.random().toString();
      const newItem = { ...item, id };
      memoryStore[tableName].set(id, newItem);
      return Promise.resolve(id);
    },
    orderBy: (_keyPath: string) => ({
      reverse: () => ({
        limit: (n: number) => ({
          toArray: () => Promise.resolve(Array.from(memoryStore[tableName].values()).slice(0, n)),
        }),
        keys: () => Promise.resolve(Array.from(memoryStore[tableName].keys())),
        toArray: () => Promise.resolve(Array.from(memoryStore[tableName].values())),
      }),
      toArray: () => Promise.resolve(Array.from(memoryStore[tableName].values())),
    }),
    where: (keyName: string) => ({
      below: (val: string) => ({
        reverse: () => ({
          first: () => {
            const sortedKeys = Array.from(memoryStore[tableName].keys()).sort();
            const targetKey = sortedKeys.reverse().find(k => k < val);
            return Promise.resolve(targetKey ? memoryStore[tableName].get(targetKey) : null);
          },
        }),
      }),
      equals: (val: unknown) => ({
        first: () => Promise.resolve(memoryStore[tableName].get(val as string) || null),
        count: () =>
          Promise.resolve(
            Array.from(memoryStore[tableName].values()).filter(
              item => (item as Record<string, unknown>)[keyName] === val
            ).length
          ),
        toArray: () =>
          Promise.resolve(
            Array.from(memoryStore[tableName].values()).filter(
              item => (item as Record<string, unknown>)[keyName] === val
            )
          ),
        sortBy: (sortKey: string) =>
          Promise.resolve(
            Array.from(memoryStore[tableName].values())
              .filter(item => (item as Record<string, unknown>)[keyName] === val)
              .sort((a, b) => {
                const valueA = (a as Record<string, unknown>)[sortKey];
                const valueB = (b as Record<string, unknown>)[sortKey];
                if (typeof valueA === 'string' && typeof valueB === 'string') {
                  return valueA.localeCompare(valueB);
                }
                if (typeof valueA === 'number' && typeof valueB === 'number') {
                  return valueA - valueB;
                }
                return 0;
              })
          ),
      }),
      startsWith: (prefix: string) => ({
        toArray: () =>
          Promise.resolve(
            Array.from(memoryStore[tableName].values()).filter(item =>
              String((item as Record<string, unknown>)[keyName] || '').startsWith(prefix)
            )
          ),
      }),
    }),
  });

  return {
    dailyRecords: createMockTable('dailyRecords'),
    catalogs: createMockTable('catalogs'),
    errorLogs: createMockTable('errorLogs'),
    auditLogs: createMockTable('auditLogs'),
    settings: createMockTable('settings'),
    syncQueue: createMockTable('syncQueue'),
    isOpen: () => true,
    open: () => Promise.resolve(),
    on: () => ({}),
    // Implements only the Dexie table methods the app calls, not the whole Table type.
  } as unknown as IndexedDbDatabaseLike;
};
