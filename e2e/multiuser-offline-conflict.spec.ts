import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import {
  bootstrapSeededRecord,
  buildCanonicalE2ERecord,
  ensureAuthenticated,
  readIndexedDbDailyRecord,
} from './fixtures/auth';
import { expectClinicalDiagnosis, updateClinicalDiagnosis } from './fixtures/clinicalBlockEditor';
import { waitForPersistedBedFields } from './fixtures/censusPersistence';
import { installDailyRecordAuthorityRoute } from './fixtures/dailyRecordAuthorityRoute';

const MULTIUSER_DATE = process.env.E2E_FIXED_DATE ?? new Date().toISOString().slice(0, 10);

const getRow = (page: Page, bedId: string) =>
  page.locator(`[data-testid="patient-row"][data-bed-id="${bedId}"]`).first();

const openSeededCensus = async (page: Page, remoteWriter = false) => {
  const baseRecord = buildCanonicalE2ERecord(MULTIUSER_DATE);
  const beds = (baseRecord.beds as Record<string, Record<string, unknown>>) || {};

  beds.R1 = {
    ...beds.R1,
    patientName: 'MULTIUSER BASELINE',
    rut: '12345678-5',
    clinicalEpisodeId: 'synthetic-multiuser-r1',
    pathology: 'BASE DX',
    status: 'Estable',
    admissionDate: MULTIUSER_DATE,
  };

  beds.R2 = {
    ...beds.R2,
    patientName: 'SECOND SYNTHETIC PATIENT',
    rut: '11111111-1',
    clinicalEpisodeId: 'synthetic-multiuser-r2',
    pathology: 'SECOND BASE DX',
    status: 'Estable',
    admissionDate: MULTIUSER_DATE,
  };
  const record = { ...baseRecord, lastUpdated: `${MULTIUSER_DATE}T08:00:00.000Z`, beds };
  const authority = remoteWriter ? await installDailyRecordAuthorityRoute(page, record) : null;
  await bootstrapSeededRecord(page, {
    role: 'editor',
    date: MULTIUSER_DATE,
    record,
    useRuntimeOverride: true,
    forceLocalOnlySync: !remoteWriter,
    seedRemoteAuthority: remoteWriter,
    forceAuthorityCallable: remoteWriter,
  });

  // The auth surface can mount before Dexie creates its schema. Do not open a
  // missing database here: that would create an empty schema ahead of the app.
  await expect
    .poll(
      async () => {
        return page.evaluate(async () => {
          if (!(await indexedDB.databases()).some(database => database.name === 'HangaRoaDB')) {
            return false;
          }
          const request = indexedDB.open('HangaRoaDB');
          const db = await new Promise<IDBDatabase>((resolve, reject) => {
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
          });
          try {
            return db.objectStoreNames.contains('dailyRecords');
          } finally {
            db.close();
          }
        });
      },
      { timeout: 20_000 }
    )
    .toBe(true);

  // Seed only the initial database state. No expected edit is written by the test.
  await page.evaluate(async initialRecord => {
    const request = indexedDB.open('HangaRoaDB');
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      const transaction = db.transaction('dailyRecords', 'readwrite');
      transaction.objectStore('dailyRecords').put(initialRecord);
      await new Promise<void>((resolve, reject) => {
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error);
      });
    } finally {
      db.close();
    }
  }, record);
  // Authenticate the existing bootstrap page before the single final census navigation.
  await ensureAuthenticated(page);
  await page.goto(`/census?date=${MULTIUSER_DATE}`);
  await expect(page.getByTestId('census-table')).toBeVisible({ timeout: 20_000 });
  return authority;
};

const buildCurrentRecordSnapshot = async (page: Page) =>
  page.evaluate(date => {
    const storageKey = 'hanga_roa_hospital_data';
    const records = JSON.parse(localStorage.getItem(storageKey) || '{}') as Record<
      string,
      { beds?: Record<string, Record<string, unknown>>; lastUpdated?: string }
    >;

    return records[date] || null;
  }, MULTIUSER_DATE);

const injectRemoteSnapshotForNextLoad = async (page: Page, snapshot: Record<string, unknown>) => {
  await page.evaluate(
    ({ date, record }) => {
      localStorage.setItem('hhr_e2e_remote_override_shadow', JSON.stringify({ date, record }));
    },
    {
      date: MULTIUSER_DATE,
      record: snapshot,
    }
  );

  await page.addInitScript(() => {
    const remoteShadow = localStorage.getItem('hhr_e2e_remote_override_shadow');
    if (!remoteShadow) return;

    const parsed = JSON.parse(remoteShadow) as { date: string; record: unknown };
    const runtimeWindow = window as Window & {
      __HHR_E2E_OVERRIDE__?: Record<string, unknown>;
    };
    const lockedRemoteRecord = parsed.record;

    runtimeWindow.__HHR_E2E_OVERRIDE__ = new Proxy(
      {
        ...(runtimeWindow.__HHR_E2E_OVERRIDE__ || {}),
        [parsed.date]: lockedRemoteRecord,
      },
      {
        set(target, property, value) {
          target[property as string] = property === parsed.date ? lockedRemoteRecord : value;
          return true;
        },
      }
    );
  });
};

const closeAll = async (contexts: BrowserContext[]) => {
  await Promise.all(contexts.map(context => context.close().catch(() => undefined)));
};

test.describe('Offline local persistence and controlled remote-authority reload', () => {
  test('resumes a paused offline edit before loading another client accepted diagnosis', async ({
    browser,
  }) => {
    test.setTimeout(90_000);
    const userAContext = await browser.newContext();
    const userBContext = await browser.newContext();

    try {
      const userAPage = await userAContext.newPage();
      const userBPage = await userBContext.newPage();

      // Each client owns its browser storage and authority route; only setup runs concurrently.
      const [, userBAuthority] = await Promise.all([
        openSeededCensus(userAPage),
        openSeededCensus(userBPage, true),
      ]);
      expect(userBAuthority).not.toBeNull();

      const userARow = getRow(userAPage, 'R1');

      await expect(userARow.locator('input[name="patientName"]').first()).toHaveValue(
        'MULTIUSER BASELINE'
      );
      await expectClinicalDiagnosis(userARow, 'BASE DX');

      expect(await readIndexedDbDailyRecord(userAPage, MULTIUSER_DATE)).toMatchObject({
        beds: { R1: { pathology: 'BASE DX' } },
      });
      await userAContext.setOffline(true);
      await expect.poll(() => userAPage.evaluate(() => navigator.onLine)).toBe(false);

      await updateClinicalDiagnosis(userAPage, userARow, 'R1', 'USER A OFFLINE DX');
      await expectClinicalDiagnosis(getRow(userAPage, 'R1'), 'USER A OFFLINE DX');
      expect(await readIndexedDbDailyRecord(userAPage, MULTIUSER_DATE)).toMatchObject({
        beds: { R1: { pathology: 'BASE DX' } },
      });
      await userAContext.setOffline(false);
      await expect.poll(() => userAPage.evaluate(() => navigator.onLine)).toBe(true);
      await waitForPersistedBedFields({
        page: userAPage,
        date: MULTIUSER_DATE,
        bedId: 'R1',
        expected: {
          patientName: 'MULTIUSER BASELINE',
          pathology: 'USER A OFFLINE DX',
        },
      });

      await updateClinicalDiagnosis(userBPage, getRow(userBPage, 'R1'), 'R1', 'REMOTE USER B DX');
      const remoteSave = await userBAuthority!.nextCall();
      expect(remoteSave.payload.patch).toMatchObject({ 'beds.R1.pathology': 'REMOTE USER B DX' });
      await remoteSave.succeed();
      await waitForPersistedBedFields({
        page: userBPage,
        date: MULTIUSER_DATE,
        bedId: 'R1',
        expected: { pathology: 'REMOTE USER B DX', clinicalEpisodeId: 'synthetic-multiuser-r1' },
      });
      const remoteSnapshot = await buildCurrentRecordSnapshot(userBPage);
      expect(remoteSnapshot).not.toBeNull();
      await injectRemoteSnapshotForNextLoad(userAPage, remoteSnapshot!);

      await userAContext.setOffline(false);
      await expect.poll(() => userAPage.evaluate(() => navigator.onLine)).toBe(true);
      await userAPage.reload({ waitUntil: 'domcontentloaded' });

      await expect(userAPage.getByTestId('census-table')).toBeVisible({ timeout: 20_000 });
      await expect(userARow.locator('input[name="patientName"]').first()).toHaveValue(
        'MULTIUSER BASELINE'
      );
      await expectClinicalDiagnosis(userARow, 'REMOTE USER B DX');
    } finally {
      await closeAll([userAContext, userBContext]);
    }
  });

  test('loads another client accepted change on a different bed after reconnect', async ({
    browser,
  }) => {
    test.setTimeout(90_000);
    const userAContext = await browser.newContext();
    const userBContext = await browser.newContext();

    try {
      const userAPage = await userAContext.newPage();
      const userBPage = await userBContext.newPage();

      // Each client owns its browser storage and authority route; only setup runs concurrently.
      const [, userBAuthority] = await Promise.all([
        openSeededCensus(userAPage),
        openSeededCensus(userBPage, true),
      ]);
      expect(userBAuthority).not.toBeNull();

      const userAR1 = getRow(userAPage, 'R1');

      expect(await readIndexedDbDailyRecord(userAPage, MULTIUSER_DATE)).toMatchObject({
        beds: { R1: { pathology: 'BASE DX' } },
      });
      await userAContext.setOffline(true);
      await expect.poll(() => userAPage.evaluate(() => navigator.onLine)).toBe(false);

      await updateClinicalDiagnosis(userAPage, userAR1, 'R1', 'USER A LOCAL DX');
      await expectClinicalDiagnosis(userAR1, 'USER A LOCAL DX');
      expect(await readIndexedDbDailyRecord(userAPage, MULTIUSER_DATE)).toMatchObject({
        beds: { R1: { pathology: 'BASE DX' } },
      });
      await userAContext.setOffline(false);
      await expect.poll(() => userAPage.evaluate(() => navigator.onLine)).toBe(true);
      await waitForPersistedBedFields({
        page: userAPage,
        date: MULTIUSER_DATE,
        bedId: 'R1',
        expected: {
          patientName: 'MULTIUSER BASELINE',
          pathology: 'USER A LOCAL DX',
        },
      });

      await updateClinicalDiagnosis(
        userBPage,
        getRow(userBPage, 'R2'),
        'R2',
        'USER B NON CONFLICT DX'
      );
      const remoteSave = await userBAuthority!.nextCall();
      expect(remoteSave.payload.patch).toMatchObject({
        'beds.R2.pathology': 'USER B NON CONFLICT DX',
      });
      await remoteSave.succeed();
      await waitForPersistedBedFields({
        page: userBPage,
        date: MULTIUSER_DATE,
        bedId: 'R2',
        expected: { patientName: 'SECOND SYNTHETIC PATIENT', pathology: 'USER B NON CONFLICT DX' },
      });
      const remoteSnapshot = await buildCurrentRecordSnapshot(userBPage);
      expect(remoteSnapshot).not.toBeNull();
      await injectRemoteSnapshotForNextLoad(userAPage, remoteSnapshot!);

      await userAContext.setOffline(false);
      await expect.poll(() => userAPage.evaluate(() => navigator.onLine)).toBe(true);
      await userAPage.reload({ waitUntil: 'domcontentloaded' });

      await expect(userAPage.getByTestId('census-table')).toBeVisible({ timeout: 20_000 });
      await expect(userAR1.locator('input[name="patientName"]').first()).toHaveValue(
        'MULTIUSER BASELINE'
      );
      await expectClinicalDiagnosis(userAR1, 'BASE DX');

      const userAR2 = getRow(userAPage, 'R2');
      await expect(userAR2.locator('input[name="patientName"]').first()).toHaveValue(
        'SECOND SYNTHETIC PATIENT'
      );
      await expectClinicalDiagnosis(userAR2, 'USER B NON CONFLICT DX');
    } finally {
      await closeAll([userAContext, userBContext]);
    }
  });
});
