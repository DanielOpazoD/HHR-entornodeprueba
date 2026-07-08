import { expect, test, type Page } from '@playwright/test';

import {
  bootstrapSeededRecord,
  buildCanonicalE2ERecord,
  ensureAuthenticated,
} from './fixtures/auth';

const E2E_DATE = process.env.E2E_FIXED_DATE ?? '2026-02-20';
const PATIENT_NAME = 'BACKUP EXPORT';

const buildBackupExportRecord = (date: string) => {
  const canonical = buildCanonicalE2ERecord(date);
  const beds = canonical.beds as Record<string, Record<string, unknown>>;

  return buildCanonicalE2ERecord(date, {
    beds: {
      ...beds,
      R1: {
        ...beds.R1,
        patientName: PATIENT_NAME,
        rut: '12.345.678-5',
        pathology: 'Respaldo operacional',
        specialty: 'Medicina',
        status: 'Estable',
        age: '58',
        admissionDate: date,
      },
    },
  });
};

const openSeededCensus = async (page: Page) => {
  await bootstrapSeededRecord(page, {
    role: 'admin',
    date: E2E_DATE,
    record: buildBackupExportRecord(E2E_DATE),
    useRuntimeOverride: true,
    forceEditableRecord: true,
  });

  await page.goto(`/censo?date=${E2E_DATE}`);
  await ensureAuthenticated(page);
  await expect(page.getByTestId('census-table')).toBeVisible({ timeout: 20000 });
  await expect(page.locator('[data-testid="patient-row"][data-bed-id="R1"]')).toContainText(
    'Respaldo operacional'
  );
};

const readStoredR1PatientName = async (page: Page) =>
  page.evaluate(
    ({ date }) => {
      const records = JSON.parse(window.localStorage.getItem('hanga_roa_hospital_data') || '{}');
      return records?.[date]?.beds?.R1?.patientName ?? null;
    },
    { date: E2E_DATE }
  );

const readLastDownload = async (page: Page) =>
  page.evaluate(
    () =>
      ((
        window as Window & {
          __HHR_DOWNLOAD_CAPTURE__?: {
            blobSize: number;
            blobType: string;
            filename: string;
          } | null;
        }
      ).__HHR_DOWNLOAD_CAPTURE__ ||
        JSON.parse(window.localStorage.getItem('hhr_e2e_last_download') || 'null')) as {
        blobSize: number;
        blobType: string;
        filename: string;
      } | null
  );

test.describe('Backup restore export smoke', () => {
  test('exports a non-empty census artifact without altering the active patient after reload', async ({
    page,
  }) => {
    await openSeededCensus(page);
    await expect.poll(() => readStoredR1PatientName(page)).toBe(PATIENT_NAME);

    const saveButton = page.getByRole('button', { name: /guardar|guardado|archivado/i }).first();
    await expect(saveButton).toBeVisible({ timeout: 10000 });
    await saveButton.click();

    const localExportAction = page.getByRole('button', { name: /descargar excel/i }).first();
    await expect(localExportAction).toBeVisible({ timeout: 10000 });
    await localExportAction.click();

    await expect.poll(() => readLastDownload(page)).toBeTruthy();
    const downloadMeta = await readLastDownload(page);

    expect(downloadMeta?.filename).toMatch(/\.xlsx$/i);
    expect(downloadMeta?.blobType).toContain(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    expect(downloadMeta?.blobSize ?? 0).toBeGreaterThan(0);

    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('census-table')).toBeVisible({ timeout: 20000 });
    await expect(page.locator('[data-testid="patient-row"][data-bed-id="R1"]')).toContainText(
      'Respaldo operacional'
    );
    await expect.poll(() => readStoredR1PatientName(page)).toBe(PATIENT_NAME);
  });
});
