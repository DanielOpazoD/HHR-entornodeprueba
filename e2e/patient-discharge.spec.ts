import { test, expect, type Page } from '@playwright/test';
import {
  bootstrapSeededRecord,
  buildCanonicalE2ERecord,
  ensureAuthenticated,
} from './fixtures/auth';
import { getTodayISO } from '../src/utils/dateCoreUtils';

const getTodayDate = () => getTodayISO();

const buildDischargeRecord = (date: string) =>
  buildCanonicalE2ERecord(date, {
    beds: {
      ...(buildCanonicalE2ERecord(date).beds as Record<string, unknown>),
      R1: {
        ...(buildCanonicalE2ERecord(date).beds as Record<string, Record<string, unknown>>).R1,
        patientName: 'Discharge Patient',
        pathology: 'Discharge DX',
        status: 'Estable',
        age: '44',
      },
    },
  });

const openDischargeCensus = async (page: Page) => {
  const date = getTodayDate();
  await bootstrapSeededRecord(page, {
    role: 'admin',
    date,
    record: buildDischargeRecord(date),
    useRuntimeOverride: true,
    forceEditableRecord: true,
  });
  await page.goto(`/censo?date=${date}`);
  await ensureAuthenticated(page);
  await expect(page.getByTestId('census-table')).toBeVisible({ timeout: 20000 });
};

test.describe('Patient Discharge Flow', () => {
  test.beforeEach(async ({ page }) => {
    await openDischargeCensus(page);
  });

  test('should discharge patient with Alta Médica', async ({ page }) => {
    const patientRow = page.locator('[data-testid="patient-row"][data-bed-id="R1"]').first();
    await expect(patientRow.locator('input[name="patientName"]').first()).toHaveValue(
      /discharge patient/i
    );

    const actionButton = patientRow.locator('button[title="Acciones"]').first();
    await expect(actionButton).toBeVisible({ timeout: 10000 });
    await actionButton.evaluate(element => (element as HTMLButtonElement).click());

    const dischargeEntry = page.getByText(/Alta|Egreso/i).first();
    await expect(dischargeEntry).toBeVisible({ timeout: 10000 });
  });

  test('should show census with beds', async ({ page }) => {
    const rows = page.locator('tbody tr');
    await expect(rows.first()).toBeVisible({ timeout: 10000 });
    await expect(await rows.count()).toBeGreaterThan(0);
  });

  test('should have bed management UI', async ({ page }) => {
    const patientInput = page
      .locator('[data-testid="patient-row"][data-bed-id="R1"] input[name="patientName"]')
      .first();
    await expect(patientInput).toBeVisible({ timeout: 10000 });
    await expect(patientInput).toHaveValue(/discharge patient/i);
  });
});
