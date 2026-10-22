/**
 * Census Navigation E2E Tests
 * Tests for date navigation and census view interactions with seeded auth/data.
 */

import { test, expect, type Page } from '@playwright/test';
import {
  bootstrapSeededRecord,
  buildCanonicalE2ERecord,
  ensureAuthenticated,
} from './fixtures/auth';
import { getTodayISO } from '../src/utils/dateCoreUtils';

const getTodayDate = () => getTodayISO();

const buildNavigationRecord = (date: string) =>
  buildCanonicalE2ERecord(date, {
    beds: {
      ...(buildCanonicalE2ERecord(date).beds as Record<string, unknown>),
      R1: {
        ...(buildCanonicalE2ERecord(date).beds as Record<string, Record<string, unknown>>).R1,
        patientName: 'Navigation Patient',
        pathology: 'Navegacion',
        status: 'Estable',
        age: '34',
      },
    },
  });

const openCensus = async (page: Page) => {
  const date = getTodayDate();
  await bootstrapSeededRecord(page, {
    role: 'editor',
    date,
    record: buildNavigationRecord(date),
    useRuntimeOverride: true,
    forceEditableRecord: true,
  });
  await page.goto(`/censo?date=${date}`);
  await ensureAuthenticated(page);
  await expect(page.getByTestId('census-table')).toBeVisible({ timeout: 20000 });
};

test.describe('Census Navigation', () => {
  test.describe('Date Selector', () => {
    test('should display date navigation controls', async ({ page }) => {
      await openCensus(page);

      await expect(page.getByRole('button', { name: 'Camas' })).toBeVisible();
      await expect(
        page.getByText(String(new Date().getFullYear()), { exact: true }).first()
      ).toBeVisible();
    });

    test('should show current date by default', async ({ page }) => {
      await openCensus(page);

      const today = new Date();
      const dayStr = String(today.getDate());
      await expect(page.getByRole('button', { name: dayStr }).first()).toBeVisible();
    });
  });

  test.describe('Bed Grid', () => {
    test('should display bed grid layout', async ({ page }) => {
      await openCensus(page);

      await expect(page.locator('tbody tr').first()).toBeVisible();
    });

    test('should show bed sections', async ({ page }) => {
      await openCensus(page);

      await expect(page.locator('tbody')).toContainText('R1');
      await expect(page.locator('tbody')).toContainText('H1C1');
    });
  });

  test.describe('Patient Information', () => {
    test('should allow focusing patient details inputs from a bed row', async ({ page }) => {
      await openCensus(page);

      const patientInput = page.locator('input[name="patientName"]').first();
      await expect(patientInput).toHaveValue('Navigation Patient');
      await patientInput.click();
      await expect(patientInput).toBeFocused();
    });
  });
});

test.describe('Census Actions', () => {
  test('should have create day button when no record exists', async ({ page }) => {
    await bootstrapSeededRecord(page, {
      role: 'editor',
      date: getTodayDate(),
      record: buildNavigationRecord(getTodayDate()),
      useRuntimeOverride: true,
      forceEditableRecord: true,
    });
    await page.goto('/censo?date=2099-01-01');
    await ensureAuthenticated(page);

    const createBtn = page.getByRole('button', {
      name: /crear|iniciar|copiar|registro en blanco/i,
    });
    await expect(createBtn.first()).toBeVisible({ timeout: 10000 });
  });

  test('should show save/export entrypoint', async ({ page }) => {
    await openCensus(page);

    await expect(page.getByRole('button', { name: /Guardar/i })).toBeVisible({ timeout: 10000 });
  });
});
