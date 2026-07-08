import { expect, test, type Page } from '@playwright/test';

const DB_NAME = 'HangaRoaDB';
const DB_VERSION = 10;
const RECORD_DATE = '2026-05-24';
const MUTATION_ID = 'mutation-e2e-pre-outbox-held';

type SyncQueueRow = {
  id?: number;
  type: string;
  status: string;
  key?: string;
  nextAttemptAt?: number;
  syncContract?: { mutationId?: string };
};

const withStore = async <T>(
  page: Page,
  storeName: string,
  mode: IDBTransactionMode,
  callbackSource: string
): Promise<T> =>
  page.evaluate(
    async ({ dbName, dbVersion, storeName, mode, callbackSource }) => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(dbName, dbVersion);
        request.onupgradeneeded = () => {
          const database = request.result;
          if (!database.objectStoreNames.contains('dailyRecords')) {
            database.createObjectStore('dailyRecords', { keyPath: 'date' });
          }
          if (!database.objectStoreNames.contains('syncQueue')) {
            const syncQueue = database.createObjectStore('syncQueue', {
              keyPath: 'id',
              autoIncrement: true,
            });
            syncQueue.createIndex('status', 'status');
            syncQueue.createIndex('timestamp', 'timestamp');
            syncQueue.createIndex('type', 'type');
            syncQueue.createIndex('key', 'key');
            syncQueue.createIndex('ownerKey', 'ownerKey');
            syncQueue.createIndex('nextAttemptAt', 'nextAttemptAt');
            syncQueue.createIndex('status,timestamp', ['status', 'timestamp']);
            syncQueue.createIndex('status,nextAttemptAt', ['status', 'nextAttemptAt']);
            syncQueue.createIndex('ownerKey,status', ['ownerKey', 'status']);
            syncQueue.createIndex('ownerKey,type', ['ownerKey', 'type']);
          }
        };
        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result);
      });

      try {
        return await new Promise((resolve, reject) => {
          const tx = db.transaction(storeName, mode);
          const store = tx.objectStore(storeName);
          const run = new Function('store', 'resolve', 'reject', callbackSource);

          tx.onerror = () => reject(tx.error);
          tx.onabort = () => reject(tx.error);
          tx.oncomplete = () => undefined;
          run(store, resolve, reject);
        });
      } finally {
        db.close();
      }
    },
    { dbName: DB_NAME, dbVersion: DB_VERSION, storeName, mode, callbackSource }
  ) as Promise<T>;

const resetSharedDatabase = async (page: Page): Promise<void> =>
  page.evaluate(
    dbName =>
      new Promise<void>((resolve, reject) => {
        const request = indexedDB.deleteDatabase(dbName);
        request.onerror = () => reject(request.error);
        request.onblocked = () => reject(new Error('IndexedDB delete was blocked'));
        request.onsuccess = () => resolve();
      }),
    DB_NAME
  );

const seedHeldPreOutboxTask = async (page: Page): Promise<number> =>
  withStore<number>(
    page,
    'syncQueue',
    'readwrite',
    `
      const now = Date.now();
      const request = store.add({
        opId: 'UPDATE_DAILY_RECORD:daily:${RECORD_DATE}:' + now,
        type: 'UPDATE_DAILY_RECORD',
        payload: {
          date: '${RECORD_DATE}',
          beds: {},
          discharges: [],
          transfers: [],
          cma: [],
          lastUpdated: '${RECORD_DATE}T10:00:00.000Z',
          nurses: [],
          activeExtraBeds: []
        },
        timestamp: now,
        retryCount: 0,
        key: 'daily:${RECORD_DATE}',
        status: 'PENDING',
        origin: 'direct_queue',
        contexts: ['clinical'],
        recoveryPolicy: 'clinical_retry',
        nextAttemptAt: now + 5000,
        syncContract: {
          expectedVersion: '${RECORD_DATE}T09:55:00.000Z',
          changedPaths: ['beds.R1.pathology'],
          mutationId: '${MUTATION_ID}'
        }
      });
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    `
  );

const readPreOutboxTask = async (page: Page): Promise<SyncQueueRow | null> =>
  withStore<SyncQueueRow | null>(
    page,
    'syncQueue',
    'readonly',
    `
      const request = store.index('key').get('daily:${RECORD_DATE}');
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result || null);
    `
  );

test.describe('Pre-outbox multitab persistence', () => {
  test('shares a held pre-outbox mutation across two real tabs without making it claimable early', async ({
    browser,
  }) => {
    const context = await browser.newContext();
    const tabA = await context.newPage();
    const tabB = await context.newPage();

    await tabA.goto('/');
    await tabB.goto('/');
    await resetSharedDatabase(tabA);

    const insertedId = await seedHeldPreOutboxTask(tabA);
    expect(insertedId).toBeGreaterThan(0);

    const taskSeenFromSecondTab = await readPreOutboxTask(tabB);

    expect(taskSeenFromSecondTab).toEqual(
      expect.objectContaining({
        type: 'UPDATE_DAILY_RECORD',
        status: 'PENDING',
        key: `daily:${RECORD_DATE}`,
        origin: 'direct_queue',
        syncContract: expect.objectContaining({ mutationId: MUTATION_ID }),
      })
    );
    expect(taskSeenFromSecondTab?.nextAttemptAt || 0).toBeGreaterThan(Date.now());

    await context.close();
  });

  test('keeps local outbox storage isolated across two BrowserContexts', async ({ browser }) => {
    const contextA = await browser.newContext();
    const contextB = await browser.newContext();
    const pageA = await contextA.newPage();
    const pageB = await contextB.newPage();

    await pageA.goto('/');
    await pageB.goto('/');
    await resetSharedDatabase(pageA);
    await resetSharedDatabase(pageB);

    await seedHeldPreOutboxTask(pageA);

    await expect(readPreOutboxTask(pageA)).resolves.toEqual(
      expect.objectContaining({
        key: `daily:${RECORD_DATE}`,
        syncContract: expect.objectContaining({ mutationId: MUTATION_ID }),
      })
    );
    await expect(readPreOutboxTask(pageB)).resolves.toBeNull();

    await contextA.close();
    await contextB.close();
  });
});
