import { test, expect, type Page } from '@playwright/test';
import {
  bootstrapSeededRecord,
  buildCanonicalE2ERecord,
  ensureAuthenticated,
} from './fixtures/auth';
import { getTodayISO } from '../src/utils/dateCoreUtils';

const getTodayDate = () => getTodayISO();

const buildAdmissionRecord = (date: string) =>
  buildCanonicalE2ERecord(date, {
    beds: {
      ...(buildCanonicalE2ERecord(date).beds as Record<string, unknown>),
      R1: {
        ...(buildCanonicalE2ERecord(date).beds as Record<string, Record<string, unknown>>).R1,
        patientName: '',
        pathology: '',
        status: '',
      },
    },
  });

const openAdmissionCensus = async (page: Page) => {
  const date = getTodayDate();
  await bootstrapSeededRecord(page, {
    role: 'admin',
    date,
    record: buildAdmissionRecord(date),
    useRuntimeOverride: true,
    forceEditableRecord: true,
  });
  await page.goto(`/censo?date=${date}`);
  await ensureAuthenticated(page);
  await expect(page.getByTestId('census-table')).toBeVisible({ timeout: 20000 });
};

const activateEmptyBed = async (page: Page) => {
  const emptyBedRow = page.locator('tbody tr').filter({ hasText: 'Agregar paciente' }).first();
  await expect(emptyBedRow).toBeVisible({ timeout: 10000 });
  await emptyBedRow.click();
};

test.describe('Complete Patient Admission', () => {
  test.beforeEach(async ({ page }) => {
    await openAdmissionCensus(page);
  });

  test('should display census table with bed rows', async ({ page }) => {
    const rows = page.locator('tbody tr');
    await expect(rows.first()).toBeVisible({ timeout: 10000 });
    await expect(await rows.count()).toBeGreaterThan(0);
  });

  test('should have input fields for patient data', async ({ page }) => {
    await activateEmptyBed(page);

    await expect(page.locator('input[name="patientName"]').first()).toBeVisible({ timeout: 10000 });
    await expect(page.getByPlaceholder('Diagnóstico (texto libre)').first()).toBeVisible();
  });

  test('should allow typing in patient name field', async ({ page }) => {
    await activateEmptyBed(page);

    const firstInput = page.locator('input[name="patientName"]').first();
    await expect(firstInput).toBeEditable({ timeout: 10000 });

    await firstInput.fill('E2E TEST PATIENT');
    await expect(firstInput).toHaveValue(/e2e test patient/i);
  });

  test('should expose additional identity input fields after admission starts', async ({
    page,
  }) => {
    await activateEmptyBed(page);

    const nameInput = page.locator('input[name="patientName"]').first();
    await expect(nameInput).toBeEditable({ timeout: 10000 });
    await nameInput.fill('RUT VISIBILITY TEST');
    await nameInput.blur();

    const rowInputs = page.locator(
      '[data-testid="patient-row"][data-bed-id="R1"] input[type="text"]'
    );
    await expect(rowInputs.nth(1)).toBeVisible({ timeout: 10000 });
  });
});
