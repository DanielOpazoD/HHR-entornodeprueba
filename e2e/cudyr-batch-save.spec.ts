import { expect, test, type Page } from '@playwright/test';
import {
  bootstrapSeededRecord,
  buildCanonicalE2ERecord,
  ensureAuthenticated,
  readIndexedDbDailyRecord,
} from './fixtures/auth';

const E2E_DATE = process.env.E2E_FIXED_DATE ?? '2026-02-20';
const CUDYR_BED = 'R1';

type PersistedDailyRecord = {
  date: string;
  beds?: Record<
    string,
    {
      cudyr?: Record<string, number>;
    }
  >;
};

const buildCudyrRecord = (date: string) => {
  const canonical = buildCanonicalE2ERecord(date);
  const beds = canonical.beds as Record<string, Record<string, unknown>>;

  return {
    ...canonical,
    date,
    beds: {
      ...beds,
      [CUDYR_BED]: {
        ...beds[CUDYR_BED],
        patientName: 'PACIENTE CUDYR E2E',
        rut: '11.111.111-1',
        pathology: 'Control de categorización CUDYR',
        specialty: 'Medicina',
        status: 'Estable',
        age: '62',
        admissionDate: '2026-02-18',
        admissionTime: '08:00',
        cudyr: {
          changeClothes: 0,
          mobilization: 0,
          feeding: 0,
          elimination: 0,
          psychosocial: 0,
          surveillance: 0,
          vitalSigns: 0,
          fluidBalance: 0,
          oxygenTherapy: 0,
          airway: 0,
          proInterventions: 0,
          skinCare: 0,
          pharmacology: 0,
          invasiveElements: 0,
        },
      },
    },
  };
};

const persistSeededRecordMirror = async (
  page: Page,
  date: string,
  record: PersistedDailyRecord
) => {
  await page.evaluate(
    async ({ dateStr, seededRecord }) => {
      const storageKey = 'hanga_roa_hospital_data';
      const records = JSON.parse(window.localStorage.getItem(storageKey) || '{}') as Record<
        string,
        PersistedDailyRecord
      >;
      records[dateStr] = seededRecord;
      window.localStorage.setItem(storageKey, JSON.stringify(records));

      const request = indexedDB.open('HangaRoaDB');
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result);
      });

      try {
        if (!db.objectStoreNames.contains('dailyRecords')) {
          return;
        }

        const transaction = db.transaction('dailyRecords', 'readwrite');
        transaction.objectStore('dailyRecords').put(seededRecord);
        await new Promise<void>((resolve, reject) => {
          transaction.oncomplete = () => resolve();
          transaction.onerror = () => reject(transaction.error);
          transaction.onabort = () => reject(transaction.error);
        });
      } finally {
        db.close();
      }
    },
    { dateStr: date, seededRecord: record }
  );
};

const openCudyr = async (page: Page) => {
  const record = buildCudyrRecord(E2E_DATE) as PersistedDailyRecord;

  await bootstrapSeededRecord(page, {
    role: 'admin',
    date: E2E_DATE,
    record,
    useRuntimeOverride: true,
    forceEditableRecord: true,
  });

  await persistSeededRecordMirror(page, E2E_DATE, record);

  await page.goto(`/cudyr?date=${E2E_DATE}`, { waitUntil: 'domcontentloaded' });
  await ensureAuthenticated(page);
  await expect(page.getByRole('heading', { name: /instrumento cudyr/i })).toBeVisible({
    timeout: 20_000,
  });
};

const getCudyrPatientRow = (page: Page) =>
  page.locator('tbody tr').filter({ hasText: 'PACIENTE CUDYR E2E' }).first();

const readPersistedCudyr = async (page: Page) => {
  const record = (await readIndexedDbDailyRecord(page, E2E_DATE)) as PersistedDailyRecord | null;
  const indexedDbCudyr = record?.beds?.[CUDYR_BED]?.cudyr;
  if (indexedDbCudyr && Object.keys(indexedDbCudyr).length > 0) {
    return indexedDbCudyr;
  }

  return page.evaluate(
    ({ date, bedId }) => {
      const records = JSON.parse(
        window.localStorage.getItem('hanga_roa_hospital_data') || '{}'
      ) as Record<string, PersistedDailyRecord>;
      return records[date]?.beds?.[bedId]?.cudyr ?? {};
    },
    { date: E2E_DATE, bedId: CUDYR_BED }
  );
};

test.describe('CUDYR batch save', () => {
  test('persists several CUDYR cell edits after manual save and reload', async ({ page }) => {
    await openCudyr(page);

    const row = getCudyrPatientRow(page);
    await expect(row).toBeVisible({ timeout: 10_000 });

    const inputs = row.getByRole('spinbutton');
    await expect(inputs).toHaveCount(14);
    await inputs.nth(0).fill('2');
    await inputs.nth(1).fill('3');
    await inputs.nth(6).fill('1');

    const pendingRow = page.getByTestId('cudyr-pending-save-row');
    await expect(pendingRow).toContainText('3 cambios pendientes');
    await pendingRow.getByRole('button', { name: /guardar cudyr/i }).click();

    await expect(page.getByText('CUDYR guardado')).toBeVisible({ timeout: 10_000 });
    await expect(pendingRow).toBeHidden({ timeout: 10_000 });

    await expect
      .poll(() => readPersistedCudyr(page), { timeout: 20_000 })
      .toMatchObject({
        changeClothes: 2,
        mobilization: 3,
        vitalSigns: 1,
      });

    await page.goto(`/cudyr?date=${E2E_DATE}`, { waitUntil: 'domcontentloaded' });
    await ensureAuthenticated(page);
    await expect(page.getByRole('heading', { name: /instrumento cudyr/i })).toBeVisible({
      timeout: 20_000,
    });

    const reloadedRow = getCudyrPatientRow(page);
    await expect(reloadedRow).toBeVisible({ timeout: 10_000 });

    const reloadedInputs = reloadedRow.getByRole('spinbutton');
    await expect(reloadedInputs.nth(0)).toHaveValue('2');
    await expect(reloadedInputs.nth(1)).toHaveValue('3');
    await expect(reloadedInputs.nth(6)).toHaveValue('1');
  });
});
