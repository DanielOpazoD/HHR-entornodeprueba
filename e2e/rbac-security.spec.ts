import { test, expect, type Page } from '@playwright/test';
import {
  bootstrapSeededRecord,
  buildCanonicalE2ERecord,
  ensureAuthenticated,
} from './fixtures/auth';

const getTodayDate = () => new Date().toISOString().slice(0, 10);

const buildViewerRecord = (date: string) =>
  buildCanonicalE2ERecord(date, {
    beds: {
      ...(buildCanonicalE2ERecord(date).beds as Record<string, unknown>),
      R1: {
        ...(buildCanonicalE2ERecord(date).beds as Record<string, Record<string, unknown>>).R1,
        patientName: 'Viewer Patient',
        pathology: 'Viewer DX',
        status: 'Estable',
      },
    },
    nursesDayShift: ['Enfermero/a 1', 'Enfermero/a 2'],
    nursesNightShift: ['Enfermero/a 1', 'Enfermero/a 2'],
    handoffNightReceives: ['Enfermero/a 1', 'Enfermero/a 2'],
  });

const openViewerCensus = async (page: Page) => {
  const date = getTodayDate();
  await bootstrapSeededRecord(page, {
    role: 'viewer',
    date,
    record: buildViewerRecord(date),
    useRuntimeOverride: true,
    forceEditableRecord: false,
  });
  await page.goto(`/censo?date=${date}`);
  await ensureAuthenticated(page);
  await expect(page.getByTestId('census-table')).toBeVisible({ timeout: 20000 });
};

test.describe('RBAC Security - Viewer Role', () => {
  test.beforeEach(async ({ page }) => {
    await openViewerCensus(page);
  });

  test('should disable patient input fields for viewers', async ({ page }) => {
    const nameInput = page.locator('input[name="patientName"]').first();
    await expect(nameInput).toBeVisible({ timeout: 10000 });
    await expect(nameInput).toHaveAttribute('readonly', '');
  });

  test('should keep patient rows non-editable for viewers even when row actions are visible', async ({
    page,
  }) => {
    await expect(page.getByRole('button', { name: /Guardar/i })).toHaveCount(0);

    const rowActionButton = page
      .locator('[data-testid="patient-row"][data-bed-id="R1"] button[title="Acciones"]')
      .first();
    await expect(rowActionButton).toBeVisible({ timeout: 10000 });
    await rowActionButton.evaluate(element => (element as HTMLButtonElement).click());

    const nameInput = page.locator('input[name="patientName"]').first();
    await expect(nameInput).toHaveAttribute('readonly', '');
  });

  test('should permit viewing handoff but prevent editing', async ({ page }) => {
    const handoffBtn = page.getByTestId('nav-tab-nursing-handoff');
    await expect(handoffBtn).toBeVisible({ timeout: 10000 });
    await handoffBtn.click();

    await expect(page.locator('main')).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId('handoff-shift-day-button')).toBeVisible({
      timeout: 10000,
    });
    await expect(page.locator('textarea[disabled], textarea[readonly]').first()).toBeVisible({
      timeout: 10000,
    });
    await expect(page.locator('input[type="checkbox"][disabled]').first()).toBeVisible({
      timeout: 10000,
    });
  });
});
