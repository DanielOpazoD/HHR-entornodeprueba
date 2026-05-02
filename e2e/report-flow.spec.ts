import { test, expect, type Page } from '@playwright/test';
import {
  bootstrapSeededRecord,
  buildCanonicalE2ERecord,
  ensureAuthenticated,
} from './fixtures/auth';

const getTodayDate = () => new Date().toISOString().slice(0, 10);

const buildReportFlowRecord = (date: string) =>
  buildCanonicalE2ERecord(date, {
    beds: {
      ...(buildCanonicalE2ERecord(date).beds as Record<string, unknown>),
      R1: {
        ...(buildCanonicalE2ERecord(date).beds as Record<string, Record<string, unknown>>).R1,
        patientName: 'Report Patient',
        pathology: 'Report DX',
        status: 'Estable',
      },
    },
    nursesDayShift: ['Enfermero/a 1', 'Enfermero/a 2'],
    nursesNightShift: ['Enfermero/a 1', 'Enfermero/a 2'],
    handoffNightReceives: ['Enfermero/a 1', 'Enfermero/a 2'],
  });

const openReportFlow = async (page: Page) => {
  const date = getTodayDate();
  await bootstrapSeededRecord(page, {
    role: 'editor',
    date,
    record: buildReportFlowRecord(date),
    useRuntimeOverride: true,
    forceEditableRecord: true,
  });
  await page.goto(`/censo?date=${date}`);
  await ensureAuthenticated(page);
  await expect(page.getByTestId('census-table')).toBeVisible({ timeout: 20000 });
};

test.describe('Handoff & Signature Link Flow', () => {
  test.beforeEach(async ({ page }) => {
    await openReportFlow(page);
  });

  test('should allow entering handoff notes and show share link', async ({ page }) => {
    const handoffBtn = page.getByTestId('nav-tab-medical-handoff');
    await expect(handoffBtn).toBeVisible({ timeout: 10000 });
    await handoffBtn.click();

    const createMedicalHandoffButton = page
      .getByTestId('medical-handoff-create-entry-button')
      .first();
    await expect(createMedicalHandoffButton).toBeVisible({ timeout: 10000 });
    await createMedicalHandoffButton.click();

    await expect(page.locator('textarea').first()).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId('medical-handoff-share-links-button')).toBeVisible({
      timeout: 10000,
    });
  });

  test('should navigate to Census and verify export options', async ({ page }) => {
    await expect(page.getByRole('button', { name: /Guardar/i }).first()).toBeVisible({
      timeout: 10000,
    });

    await page
      .getByRole('button', { name: /Guardar/i })
      .first()
      .click();
    await expect(page.getByText(/Excel Local|Excel/i).first()).toBeVisible({ timeout: 10000 });
  });
});
