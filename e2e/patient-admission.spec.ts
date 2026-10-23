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

const openAdmissionFlow = async (page: Page) => {
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

test.describe('Patient Admission Flow', () => {
  test.beforeEach(async ({ page }) => {
    await openAdmissionFlow(page);
  });

  test('should admit a new patient to an empty bed', async ({ page }) => {
    const emptyBedRow = page.locator('tbody tr').filter({ hasText: 'Agregar paciente' }).first();
    await expect(emptyBedRow).toBeVisible({ timeout: 10000 });
    await emptyBedRow.click();

    const nameInput = page.locator('input[name="patientName"]').first();
    await expect(nameInput).toBeEditable({ timeout: 10000 });

    await nameInput.fill('Test Patient E2E');
    await nameInput.blur();

    await expect(nameInput).toHaveValue(/test patient e2e/i);
    await expect(page.getByRole('button', { name: /Guardar/i })).toBeVisible({ timeout: 10000 });
  });

  test('should validate required fields', async ({ page }) => {
    const emptyBedRow = page.locator('tbody tr').filter({ hasText: 'Agregar paciente' }).first();
    await expect(emptyBedRow).toBeVisible({ timeout: 10000 });
    await emptyBedRow.click();

    const patientInputs = page.locator('input[name="patientName"]');
    await expect(patientInputs.first()).toBeVisible({ timeout: 10000 });
    await expect(await patientInputs.count()).toBeGreaterThan(0);

    const pathologyInput = page.getByPlaceholder('Diagnóstico (texto libre)').first();
    await expect(pathologyInput).toBeVisible();
  });
});
