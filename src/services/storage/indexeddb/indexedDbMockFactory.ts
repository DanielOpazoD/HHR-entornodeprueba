import type { IndexedDbDatabaseLike } from '@/services/storage/indexeddb/indexedDbContracts';

export const createMockDatabase = (): IndexedDbDatabaseLike => {
  const memoryStore = {
    dailyRecords: new Map<string, unknown>(),
    catalogs: new Map<string, unknown>(),
    errorLogs: new Map<string, unknown>(),
    auditLogs: new Map<string, unknown>(),
    settings: new Map<string, unknown>(),
    syncQueue: new Map<string, unknown>(),
  };

  const createMockTable = (tableName: keyof typeof memoryStore) => {
    const store = memoryStore[tableName];
    return {
      toArray: () => Promise.resolve(Array.from(store.values())),
      get: (key: string) => Promise.resolve(store.get(key) || null),
      put: (item: Record<string, unknown>) => {
        const key = (item.date as string) || (item.id as string) || 'default';
        store.set(key, item);
        return Promise.resolve(key);
      },
      delete: (key: string) => {
        store.delete(key);
        return Promise.resolve();
      },
      clear: () => {
        store.clear();
        return Promise.resolve();
      },
      bulkPut: (items: Record<string, unknown>[]) => {
        items.forEach(item => {
          const key = (item.date as string) || (item.id as string) || 'default';
          store.set(key, item);
        });
        return Promise.resolve('');
      },
      update: (id: string, changes: Record<string, unknown>) => {
        const existing = Array.from(store.values()).find(item => {
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
        store.set(id, newItem);
        return Promise.resolve(id);
      },
      orderBy: (_keyPath: string) => ({
        reverse: () => ({
          limit: (n: number) => ({
            toArray: () => Promise.resolve(Array.from(store.values()).slice(0, n)),
          }),
          keys: () => Promise.resolve(Array.from(store.keys())),
          toArray: () => Promise.resolve(Array.from(store.values())),
        }),
        toArray: () => Promise.resolve(Array.from(store.values())),
      }),
      where: (keyName: string) => ({
        below: (val: string) => ({
          reverse: () => ({
            first: () => {
              const sortedKeys = Array.from(store.keys()).sort();
              const targetKey = sortedKeys.reverse().find(k => k < val);
              return Promise.resolve(targetKey ? store.get(targetKey) : null);
            },
          }),
        }),
        equals: (val: unknown) => ({
          first: () => Promise.resolve(store.get(val as string) || null),
          count: () =>
            Promise.resolve(
              Array.from(store.values()).filter(
                item => (item as Record<string, unknown>)[keyName] === val
              ).length
            ),
          toArray: () =>
            Promise.resolve(
              Array.from(store.values()).filter(
                item => (item as Record<string, unknown>)[keyName] === val
              )
            ),
          sortBy: (sortKey: string) =>
            Promise.resolve(
              Array.from(store.values())
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
              Array.from(store.values()).filter(item =>
                String((item as Record<string, unknown>)[keyName] || '').startsWith(prefix)
              )
            ),
        }),
      }),
    };
  };

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
