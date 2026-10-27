import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import {
  bootstrapSeededRecord,
  buildCanonicalE2ERecord,
  ensureAuthenticated,
  readIndexedDbDailyRecord,
} from './fixtures/auth';
import {
  expectClinicalDiagnosis,
  expectClinicalEditorClosed,
  submitClinicalDiagnosis,
} from './fixtures/clinicalBlockEditor';
import { waitForPersistedBedFields } from './fixtures/censusPersistence';
import { installDailyRecordAuthorityRoute } from './fixtures/dailyRecordAuthorityRoute';
import { getTodayISO } from '../src/utils/dateCoreUtils';
import type { SyncTask } from '../src/services/storage/syncQueueTypes';

const MULTIUSER_DATE = process.env.E2E_FIXED_DATE ?? getTodayISO();

const insertSyncTask = (page: Page, task: SyncTask) =>
  page.evaluate(async pending => {
    const request = indexedDB.open('HangaRoaDB');
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      const transaction = db.transaction('syncQueue', 'readwrite');
      const insert = transaction.objectStore('syncQueue').add(pending);
      await new Promise<void>((resolve, reject) => {
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error);
      });
      const taskId = insert.result;
      if (typeof taskId !== 'number') throw new Error('Expected a numeric sync task id');
      return taskId;
    } finally {
      db.close();
    }
  }, task);

const readSyncTask = (page: Page, id: number) =>
  page.evaluate(async taskId => {
    const request = indexedDB.open('HangaRoaDB');
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      const read = db.transaction('syncQueue', 'readonly').objectStore('syncQueue').get(taskId);
      return await new Promise<unknown>((resolve, reject) => {
        read.onsuccess = () => resolve(read.result);
        read.onerror = () => reject(read.error);
      });
    } finally {
      db.close();
    }
  }, id);

test('keeps a write without its original version available for review after reload', async ({
  page,
}) => {
  await openSeededCensus(page);
  const task: SyncTask = {
    opId: 'synthetic-baseless-review',
    type: 'UPDATE_DAILY_RECORD',
    key: `daily:${MULTIUSER_DATE}`,
    timestamp: Date.now(),
    retryCount: 0,
    status: 'FAILED',
    lastErrorCode: 'functions/failed-precondition',
    lastErrorCategory: 'validation',
    error:
      '[validation/functions/failed-precondition] base_required: An existing daily record requires a verifiable base version.',
    syncContract: { expectedVersion: '', changedPaths: ['beds.R1.pathology'] },
    payload: { date: MULTIUSER_DATE, beds: { R1: { pathology: 'PENDIENTE SINTETICO' } } },
  };
  const id = await insertSyncTask(page, task);

  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('census-table')).toBeVisible();
  await page.getByRole('button', { name: 'Guardado pendiente · Ver detalle' }).click();
  const details = page.getByTestId('rayen-local-sync-details');
  await details.locator('summary').first().click();
  await expect(details.getByText('Requiere revisión de la versión de origen')).toBeVisible();
  await expect(details.getByText(/Los cambios siguen guardados en este equipo/)).toBeVisible();
  await expect(details.getByRole('button', { name: 'Reintentar', exact: true })).toHaveCount(0);
  await expect(details.getByRole('button', { name: 'Descartar', exact: true })).toHaveCount(0);

  // Read the durable row, rather than inferring persistence from the visible diagnosis.
  const stored = await readSyncTask(page, id);
  expect(stored).toEqual({ ...task, id });
});

test('withdraws an unnecessary permission-blocked send with a downloadable backup that survives reload', async ({
  page,
}) => {
  await openSeededCensus(page);
  const task: SyncTask = {
    opId: 'synthetic-permission-withdrawal',
    type: 'UPDATE_DAILY_RECORD',
    key: 'daily:2026-10-22',
    timestamp: Date.now(),
    retryCount: 0,
    status: 'FAILED',
    lastErrorCode: 'permission-denied',
    lastErrorCategory: 'authorization',
    error: 'Missing or insufficient permissions',
    payload: { date: '2026-10-22', beds: {}, nurses: ['SYNTHETIC WITHDRAWN SEND'] },
  };
  const id = await insertSyncTask(page, task);
  await page.getByRole('button', { name: 'Guardado pendiente · Ver detalle' }).click();
  const details = page.getByTestId('rayen-local-sync-details');
  await details.locator('summary').first().click();
  await expect(details.getByText('Sin permisos')).toBeVisible();
  await expect(details.getByText(/El servidor rechazó este envío por permisos/)).toBeVisible();
  await details.getByText('Revisar reintento', { exact: true }).click();
  expect(await readSyncTask(page, id)).toEqual({ ...task, id });
  await details.getByText('Revisar reintento', { exact: true }).click();
  await details.getByRole('button', { name: 'Descartar envío', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Descartar envío del censo' });
  await expect(dialog.getByText('Censo del 22-10-2026')).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Sí, descartar envío' })).toBeDisabled();
  await dialog.getByRole('button', { name: 'Cancelar' }).click();
  expect(await readSyncTask(page, id)).toEqual({ ...task, id });
  await details.getByRole('button', { name: 'Descartar envío', exact: true }).click();
  await dialog.getByRole('checkbox').check();
  await dialog.getByRole('button', { name: 'Sí, descartar envío' }).click();
  await expect(page.getByRole('button', { name: 'Descargar respaldo' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Guardado pendiente · Ver detalle' })).toHaveCount(
    0
  );
  const stored = await readSyncTask(page, id);
  expect(stored).toMatchObject({
    ...task,
    id,
    status: 'RETIRED',
    retirement: { reason: 'manual_discard' },
  });
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Descargar respaldo' }).click();
  const download = await downloaded;
  const stream = await download.createReadStream();
  let contents = '';
  for await (const chunk of stream) contents += chunk.toString();
  expect(JSON.parse(contents)).toMatchObject({ remotelyConfirmed: false, task: stored });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('census-table')).toBeVisible();
  expect(await readSyncTask(page, id)).toEqual(stored);
  await expect(page.getByRole('button', { name: 'Guardado pendiente · Ver detalle' })).toHaveCount(
    0
  );
});

const getRow = (page: Page, bedId: string) =>
  page.locator(`[data-testid="patient-row"][data-bed-id="${bedId}"]`).first();

test('reaches an older blocked send beyond two pages and withdraws only that send with its backup', async ({
  page,
}) => {
  await openSeededCensus(page);
  const blocked: SyncTask = {
    opId: 'synthetic-old-blocked-send',
    type: 'UPDATE_DAILY_RECORD',
    key: 'daily:2026-10-22',
    timestamp: Date.now() - 3_600_000,
    status: 'FAILED',
    retryCount: 0,
    lastErrorCategory: 'authorization',
    lastErrorCode: 'permission-denied',
    payload: { date: '2026-10-22', beds: {}, nurses: ['SYNTHETIC OLD SEND'] },
  };
  const blockedId = await insertSyncTask(page, blocked);
  const pendingIds: number[] = [];
  for (let index = 1; index <= 24; index++) {
    const date = `2026-02-${String(index).padStart(2, '0')}`;
    pendingIds.push(
      await insertSyncTask(page, {
        opId: `synthetic-newer-${index}`,
        type: 'UPDATE_DAILY_RECORD',
        key: `daily:${date}`,
        timestamp: Date.now() + index,
        status: 'PENDING',
        retryCount: index === 1 ? 1 : 0,
        payload: { date, beds: {}, nurses: [] },
      })
    );
  }
  await page.getByRole('button', { name: 'Guardado pendiente · Ver detalle' }).click();
  const details = page.getByTestId('rayen-local-sync-details');
  await details.locator('summary').first().click();
  await expect(details.getByText('Guardado local · 25 por enviar')).toBeVisible();
  const oldSend = details.getByText('Censo del 22-10-2026');
  await expect(oldSend).toHaveCount(0);
  await details.getByRole('button', { name: 'Ver más envíos' }).click();
  await expect(oldSend).toHaveCount(0);
  await details.getByRole('button', { name: 'Ver más envíos' }).click();
  await expect(oldSend).toBeVisible();
  await expect(details.getByRole('button', { name: 'Ver más envíos' })).toHaveCount(0);
  await details.getByRole('button', { name: 'Descartar envío', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Descartar envío del censo' });
  await dialog.getByRole('checkbox').check();
  await dialog.getByRole('button', { name: 'Sí, descartar envío' }).click();
  await expect(page.getByRole('button', { name: 'Descargar respaldo' })).toBeVisible();
  expect(await readSyncTask(page, blockedId)).toMatchObject({
    ...blocked,
    status: 'RETIRED',
    retirement: { reason: 'manual_discard' },
  });
  expect(await readSyncTask(page, pendingIds[0])).toMatchObject({
    status: 'PENDING',
    retryCount: 1,
  });
  expect(await readSyncTask(page, pendingIds[23])).toMatchObject({
    status: 'PENDING',
    opId: 'synthetic-newer-24',
  });
});

test('shows a failed recent-send read instead of a healthy empty queue and recovers after reload', async ({
  page,
}) => {
  await openSeededCensus(page);
  await page.evaluate(() => {
    const index = IDBObjectStore.prototype.index;
    IDBObjectStore.prototype.index = function (this: IDBObjectStore, name: string) {
      if (this.name === 'syncQueue' && name === 'timestamp') {
        throw new DOMException('Synthetic recent-send read failure', 'UnknownError');
      }
      return index.call(this, name);
    };
  });

  const attention = page.getByRole('button', { name: 'Guardado pendiente · Ver detalle' });
  await expect(attention).toBeVisible({ timeout: 10_000 });
  await attention.click();
  const details = page.getByTestId('rayen-local-sync-details');
  await details.locator('summary').first().click();
  await expect(details.getByText('Guardado local · por comprobar')).toBeVisible();
  await expect(details.getByText('No se pudo leer la cola local.')).toBeVisible();
  await expect(details.getByText('Guardado local · 0 por enviar')).toHaveCount(0);

  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('census-table')).toBeVisible();
  await expect(attention).toHaveCount(0);
});

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
  await page.goto(`/census?date=${MULTIUSER_DATE}`, { waitUntil: 'domcontentloaded' });
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

      await submitClinicalDiagnosis(userAPage, userARow, 'R1', 'USER A OFFLINE DX');
      await expect(userAPage.getByTestId('clinical-block-editor-R1')).toBeVisible();
      await expect(userAPage.getByTestId('clinical-block-save-R1')).toBeDisabled();
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
      await expectClinicalEditorClosed(userAPage, 'R1');

      await submitClinicalDiagnosis(userBPage, getRow(userBPage, 'R1'), 'R1', 'REMOTE USER B DX');
      const remoteSave = await userBAuthority!.nextCall();
      expect(remoteSave.payload.patch).toMatchObject({ 'beds.R1.pathology': 'REMOTE USER B DX' });
      await expect(userBPage.getByTestId('clinical-block-editor-R1')).toBeVisible();
      await expect(userBPage.getByTestId('clinical-block-save-R1')).toBeDisabled();
      await remoteSave.succeed();
      await waitForPersistedBedFields({
        page: userBPage,
        date: MULTIUSER_DATE,
        bedId: 'R1',
        expected: { pathology: 'REMOTE USER B DX', clinicalEpisodeId: 'synthetic-multiuser-r1' },
      });
      await expectClinicalEditorClosed(userBPage, 'R1');
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

      await submitClinicalDiagnosis(userAPage, userAR1, 'R1', 'USER A LOCAL DX');
      await expect(userAPage.getByTestId('clinical-block-editor-R1')).toBeVisible();
      await expect(userAPage.getByTestId('clinical-block-save-R1')).toBeDisabled();
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
      await expectClinicalEditorClosed(userAPage, 'R1');

      await submitClinicalDiagnosis(
        userBPage,
        getRow(userBPage, 'R2'),
        'R2',
        'USER B NON CONFLICT DX'
      );
      const remoteSave = await userBAuthority!.nextCall();
      expect(remoteSave.payload.patch).toMatchObject({
        'beds.R2.pathology': 'USER B NON CONFLICT DX',
      });
      await expect(userBPage.getByTestId('clinical-block-editor-R2')).toBeVisible();
      await expect(userBPage.getByTestId('clinical-block-save-R2')).toBeDisabled();
      await remoteSave.succeed();
      await waitForPersistedBedFields({
        page: userBPage,
        date: MULTIUSER_DATE,
        bedId: 'R2',
        expected: { patientName: 'SECOND SYNTHETIC PATIENT', pathology: 'USER B NON CONFLICT DX' },
      });
      await expectClinicalEditorClosed(userBPage, 'R2');
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
