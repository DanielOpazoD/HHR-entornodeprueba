import { test, expect } from '@playwright/test';
import {
  bootstrapSeededRecord,
  buildCanonicalE2ERecord,
  ensureAuthenticated,
} from './fixtures/auth';
import { getTodayISO } from '../src/utils/dateCoreUtils';

const EXPORT_DATE = getTodayISO();

test.describe('Export artifact validation', () => {
  test('downloads a local Excel artifact with a non-empty payload', async ({ page }) => {
    const baseRecord = buildCanonicalE2ERecord(EXPORT_DATE);
    const beds = (baseRecord.beds as Record<string, Record<string, unknown>>) || {};

    beds.R1 = {
      ...beds.R1,
      patientName: 'EXPORT PATIENT',
      pathology: 'EXPORT DX',
      status: 'Estable',
      admissionDate: EXPORT_DATE,
    };

    await bootstrapSeededRecord(page, {
      role: 'admin',
      date: EXPORT_DATE,
      record: { ...baseRecord, beds },
      useRuntimeOverride: true,
    });

    await page.goto(`/censo?date=${EXPORT_DATE}`);
    await ensureAuthenticated(page);
    await expect(page.getByTestId('census-table')).toBeVisible({ timeout: 20_000 });

    const saveButton = page.getByRole('button', { name: /Guardar|Guardado|Archivado/i }).first();
    await expect(saveButton).toBeVisible();
    await saveButton.evaluate((element: HTMLElement) => element.click());

    await page.getByText('Descargar Local', { exact: false }).click();
    await expect
      .poll(async () =>
        page.evaluate(
          () =>
            (window as Window & { __HHR_DOWNLOAD_CAPTURE__?: unknown }).__HHR_DOWNLOAD_CAPTURE__ ||
            window.localStorage.getItem('hhr_e2e_last_download')
        )
      )
      .toBeTruthy();

    const downloadMeta = await page.evaluate(
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

    expect(downloadMeta?.filename).toMatch(/\.xlsx$/i);
    expect(downloadMeta?.blobType).toContain(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    expect(downloadMeta?.blobSize || 0).toBeGreaterThan(0);
    await expect(page.getByTestId('census-table')).toBeVisible();
  });
});
