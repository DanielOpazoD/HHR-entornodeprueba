import { expect, test, type Page } from '@playwright/test';

import {
  bootstrapSeededRecord,
  buildCanonicalE2ERecord,
  ensureAuthenticated,
} from './fixtures/auth';

const E2E_DATE = process.env.E2E_FIXED_DATE ?? '2026-02-20';

const buildHandoffExportRecord = (date: string) => {
  const canonical = buildCanonicalE2ERecord(date);
  const beds = canonical.beds as Record<string, Record<string, unknown>>;

  return buildCanonicalE2ERecord(date, {
    beds: {
      ...beds,
      R1: {
        ...beds.R1,
        patientName: 'HANDOFF EXPORT',
        rut: '12.345.678-5',
        pathology: 'Neumonia en control',
        specialty: 'Medicina',
        status: 'Estable',
        age: '64',
        admissionDate: date,
        handoffObservations: 'Controlar saturometria y balance.',
      },
    },
    nursesDayShift: ['Enfermero/a Dia'],
    nursesNightShift: ['Enfermero/a Noche'],
    handoffNightReceives: ['Enfermero/a Receptor'],
  });
};

const openNursingHandoff = async (page: Page) => {
  await bootstrapSeededRecord(page, {
    role: 'admin',
    date: E2E_DATE,
    record: buildHandoffExportRecord(E2E_DATE),
    useRuntimeOverride: true,
    forceEditableRecord: true,
  });

  await page.goto(`/censo?date=${E2E_DATE}`);
  await ensureAuthenticated(page);
  await expect(page.getByTestId('census-table')).toBeVisible({ timeout: 20000 });

  await page.getByTestId('nav-tab-nursing-handoff').click();
  await expect(page).toHaveURL(/\/nursing-handoff/, { timeout: 20000 });
  await expect(page.getByTestId('handoff-shift-day-button')).toBeVisible({ timeout: 10000 });
  await expect(page.locator('main')).toContainText('HANDOFF EXPORT');
};

test.describe('Handoff shift export smoke', () => {
  test('exports the active nursing handoff as a local PDF artifact', async ({ page }) => {
    await openNursingHandoff(page);

    const saveButton = page.getByRole('button', { name: /guardar|guardado|archivado/i }).first();
    await expect(saveButton).toBeVisible({ timeout: 10000 });
    await saveButton.click();

    const exportPdfAction = page.getByRole('button', { name: /descargar pdf/i }).first();
    await expect(exportPdfAction).toBeVisible({ timeout: 10000 });

    const downloadPromise = page.waitForEvent('download');
    await exportPdfAction.click();
    const download = await downloadPromise;

    expect(download.suggestedFilename()).toMatch(/\.pdf$/i);
    await expect(page.locator('main')).toContainText('HANDOFF EXPORT');
  });
});
