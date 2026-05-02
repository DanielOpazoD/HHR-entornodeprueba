/**
 * E2E Tests: Patient Operations
 * Tests row-level patient operations and navigation with seeded auth/data.
 */

import { test, expect, type Page } from '@playwright/test';
import {
  bootstrapSeededRecord,
  buildCanonicalE2ERecord,
  ensureAuthenticated,
} from './fixtures/auth';

const getTodayDate = () => new Date().toISOString().slice(0, 10);

const buildPatientOperationsRecord = (date: string) =>
  buildCanonicalE2ERecord(date, {
    beds: {
      ...(buildCanonicalE2ERecord(date).beds as Record<string, unknown>),
      R1: {
        ...(buildCanonicalE2ERecord(date).beds as Record<string, Record<string, unknown>>).R1,
        patientName: 'Operations Patient',
        pathology: 'Operations DX',
        status: 'Estable',
      },
    },
  });

const openPatientOperations = async (page: Page) => {
  const date = getTodayDate();
  await bootstrapSeededRecord(page, {
    role: 'editor',
    date,
    record: buildPatientOperationsRecord(date),
    useRuntimeOverride: true,
    forceEditableRecord: true,
  });
  await page.goto(`/censo?date=${date}`);
  await ensureAuthenticated(page);
  await expect(page.getByTestId('census-table')).toBeVisible({ timeout: 20000 });
};

test.describe('Patient Operations Flow', () => {
  test.beforeEach(async ({ page }) => {
    await openPatientOperations(page);
  });

  test('should expose row-level discharge/egress actions for an occupied patient', async ({
    page,
  }) => {
    const patientRow = page.locator('[data-testid="patient-row"][data-bed-id="R1"]').first();
    await expect(patientRow.locator('input[name="patientName"]').first()).toHaveValue(
      /operations patient/i
    );

    const actionsButton = patientRow.locator('button[title="Acciones"]').first();
    await expect(actionsButton).toBeVisible({ timeout: 10000 });
    await actionsButton.evaluate(element => (element as HTMLButtonElement).click());

    await expect(page.getByText(/Alta|Egreso/i).first()).toBeVisible({ timeout: 10000 });
  });

  test('should switch to Medical Handoff view', async ({ page }) => {
    const medicalHandoffBtn = page.getByTestId('nav-tab-medical-handoff');
    await expect(medicalHandoffBtn).toBeVisible({ timeout: 10000 });
    await medicalHandoffBtn.click();

    await expect(page.locator('main')).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId('medical-handoff-share-links-button')).toBeVisible({
      timeout: 10000,
    });
  });

  test('should switch to Nursing Handoff view', async ({ page }) => {
    const nursingHandoffBtn = page.getByTestId('nav-tab-nursing-handoff');
    await expect(nursingHandoffBtn).toBeVisible({ timeout: 10000 });
    await nursingHandoffBtn.click();

    await expect(page.locator('main')).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId('handoff-shift-day-button')).toBeVisible({
      timeout: 10000,
    });
  });
});
