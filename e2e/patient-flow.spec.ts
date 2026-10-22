import { test, expect, type Page } from '@playwright/test';
import {
  bootstrapSeededRecord,
  buildCanonicalE2ERecord,
  ensureAuthenticated,
} from './fixtures/auth';
import { getTodayISO } from '../src/utils/dateCoreUtils';

const getTodayDate = () => getTodayISO();

const buildRegistrationRecord = (date: string) =>
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

const openRegistrationFlow = async (page: Page) => {
  const date = getTodayDate();
  await bootstrapSeededRecord(page, {
    role: 'editor',
    date,
    record: buildRegistrationRecord(date),
    useRuntimeOverride: true,
    forceEditableRecord: true,
  });
  await page.goto(`/censo?date=${date}`);
  await ensureAuthenticated(page);
  await expect(page.getByTestId('census-table')).toBeVisible({ timeout: 20000 });
};

test.describe('Patient Registration Flow', () => {
  test.beforeEach(async ({ page }) => {
    await openRegistrationFlow(page);
  });

  test('should allow creating a blank day and adding a patient', async ({ page }) => {
    const emptyBedRow = page.locator('tbody tr').filter({ hasText: 'Agregar paciente' }).first();
    await expect(emptyBedRow).toBeVisible({ timeout: 10000 });
    await emptyBedRow.click();

    const nameInput = page.locator('input[name="patientName"]').first();
    await expect(nameInput).toBeEditable({ timeout: 10000 });

    await nameInput.fill('NUEVO PACIENTE E2E');
    await nameInput.blur();

    await expect(nameInput).toHaveValue(/nuevo paciente e2e/i);
  });
});
