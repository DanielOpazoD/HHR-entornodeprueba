import { expect, Page } from '@playwright/test';

interface WaitForPersistedBedFieldsInput {
  page: Page;
  date: string;
  bedId: string;
  expected: Record<string, string | boolean | number | null>;
}

interface SeedPersistedBedFieldsInput {
  page: Page;
  date: string;
  bedId: string;
  fields: Record<string, string | boolean | number | null>;
}

const isNavigationContextReset = (error: unknown) => {
  const message = String((error as Error)?.message || error);
  return (
    message.includes('Execution context was destroyed') ||
    message.includes('Cannot find context with specified id')
  );
};

const isStorageAccessDenied = (error: unknown) => {
  const message = String((error as Error)?.message || error);
  return (
    message.includes('SecurityError') ||
    (message.includes('localStorage') && message.includes('Access is denied'))
  );
};

const waitForDocumentAfterNavigation = async (page: Page) => {
  await page.waitForLoadState('domcontentloaded').catch(() => undefined);
};

const isPageOffline = async (page: Page): Promise<boolean> =>
  page.evaluate(() => !navigator.onLine).catch(() => false);

const seedFromAppOrigin = async (page: Page, seed: () => Promise<unknown>) => {
  const shouldRestoreOffline = await isPageOffline(page);
  await page.context().setOffline(false);
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await seed();
  if (shouldRestoreOffline) {
    await page.context().setOffline(true);
  }
};

export const waitForPersistedBedFields = async ({
  page,
  date,
  bedId,
  expected,
}: WaitForPersistedBedFieldsInput) => {
  const expectedKeys = Object.keys(expected);
  await expect
    .poll(
      async () => {
        try {
          return await page.evaluate(
            ({ evalDate, evalBedId, evalExpectedKeys }) => {
              const records = JSON.parse(
                window.localStorage.getItem('hanga_roa_hospital_data') || '{}'
              ) as Record<string, { beds?: Record<string, Record<string, unknown>> }>;
              const bed = records?.[evalDate]?.beds?.[evalBedId] || {};
              return Object.fromEntries(
                evalExpectedKeys.map(key => [
                  key,
                  (bed[key] as string | boolean | number | null) ?? null,
                ])
              );
            },
            {
              evalDate: date,
              evalBedId: bedId,
              evalExpectedKeys: expectedKeys,
            }
          );
        } catch (error) {
          if (!isNavigationContextReset(error) && !isStorageAccessDenied(error)) {
            throw error;
          }

          return Object.fromEntries(expectedKeys.map(key => [key, null]));
        }
      },
      {
        timeout: 20_000,
      }
    )
    .toMatchObject(expected);
};

export const seedPersistedBedFields = async ({
  page,
  date,
  bedId,
  fields,
}: SeedPersistedBedFieldsInput) => {
  const seedInCurrentDocument = () =>
    page.evaluate(
      ({ targetDate, targetBedId, targetFields }) => {
        const storageKey = 'hanga_roa_hospital_data';
        const records = JSON.parse(window.localStorage.getItem(storageKey) || '{}') as Record<
          string,
          { beds?: Record<string, Record<string, unknown>>; lastUpdated?: string }
        >;
        const currentRecord = records[targetDate] || {};
        const currentBeds = currentRecord.beds || {};
        const nextRecord = {
          ...currentRecord,
          lastUpdated: new Date().toISOString(),
          beds: {
            ...currentBeds,
            [targetBedId]: {
              ...(currentBeds[targetBedId] || {}),
              ...targetFields,
            },
          },
        };

        records[targetDate] = nextRecord;
        window.localStorage.setItem(storageKey, JSON.stringify(records));

        const persistIndexedDbMirror = async () => {
          const request = indexedDB.open('HangaRoaDB');
          const db = await new Promise<IDBDatabase>((resolve, reject) => {
            request.onerror = () => reject(request.error);
            request.onsuccess = () => resolve(request.result);
          });

          try {
            const transaction = db.transaction('dailyRecords', 'readwrite');
            const store = transaction.objectStore('dailyRecords');
            store.put(nextRecord);
            await new Promise<void>((resolve, reject) => {
              transaction.oncomplete = () => resolve();
              transaction.onerror = () => reject(transaction.error);
              transaction.onabort = () => reject(transaction.error);
            });
          } finally {
            db.close();
          }
        };

        const runtimeWindow = window as Window & {
          __HHR_E2E_OVERRIDE__?: Record<string, unknown>;
        };
        runtimeWindow.__HHR_E2E_OVERRIDE__ = {
          ...(runtimeWindow.__HHR_E2E_OVERRIDE__ || {}),
          [targetDate]: nextRecord as unknown,
        };

        return persistIndexedDbMirror();
      },
      {
        targetDate: date,
        targetBedId: bedId,
        targetFields: fields,
      }
    );

  const maxAttempts = 4;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await waitForDocumentAfterNavigation(page);
      await seedInCurrentDocument();
      return;
    } catch (error) {
      if (isStorageAccessDenied(error)) {
        await seedFromAppOrigin(page, seedInCurrentDocument);
        return;
      }

      if (!isNavigationContextReset(error) || attempt === maxAttempts) {
        throw error;
      }

      await page.waitForTimeout(250 * attempt);
    }
  }
};
