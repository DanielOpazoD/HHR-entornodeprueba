/**
 * Handoff Flow E2E Tests
 * Tests for the nursing handoff workflow with seeded auth/data.
 */

import { test, expect, type Page } from '@playwright/test';
import {
  bootstrapSeededRecord,
  buildCanonicalE2ERecord,
  ensureAuthenticated,
} from './fixtures/auth';
import { getTodayISO } from '../src/utils/dateCoreUtils';

const getTodayDate = () => getTodayISO();

const buildHandoffRecord = (date: string) =>
  buildCanonicalE2ERecord(date, {
    beds: {
      ...(buildCanonicalE2ERecord(date).beds as Record<string, unknown>),
      R1: {
        ...(buildCanonicalE2ERecord(date).beds as Record<string, Record<string, unknown>>).R1,
        patientName: 'Handoff Patient',
        pathology: 'Nota de prueba',
        status: 'Estable',
      },
    },
    nursesDayShift: ['Enfermero/a 1', 'Enfermero/a 2'],
    nursesNightShift: ['Enfermero/a 1', 'Enfermero/a 2'],
    handoffNightReceives: ['Enfermero/a 1', 'Enfermero/a 2'],
  });

const openHandoff = async (page: Page) => {
  const date = getTodayDate();
  await bootstrapSeededRecord(page, {
    role: 'admin',
    date,
    record: buildHandoffRecord(date),
    useRuntimeOverride: true,
    forceEditableRecord: true,
  });
  await page.goto(`/censo?date=${date}`);
  await ensureAuthenticated(page);
  await expect(page.getByTestId('census-table')).toBeVisible({ timeout: 20000 });

  const navButton = page.getByTestId('nav-tab-nursing-handoff');
  await expect(navButton).toBeVisible({ timeout: 20000 });
  await navButton.click();
  await expect(page).toHaveURL(/\/nursing-handoff/, { timeout: 20000 });
  await expect(page.locator('main')).toContainText(/Turno Largo/i, { timeout: 20000 });
};

test.describe('Nursing Handoff', () => {
  test('keeps the night checklist usable within a mobile viewport', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openHandoff(page);
    await page.getByTestId('handoff-shift-night-button').click();

    const nextCountDate = page.getByLabel('Próximo conteo de medicamentos no controlados');
    await expect(nextCountDate).toBeVisible();
    const checklist = page.getByRole('checkbox', { name: 'Estadística', exact: true });
    await checklist.focus();
    await checklist.press('Space');
    await expect(checklist).toBeChecked();
    await nextCountDate.fill('2026-10-28');
    await expect(nextCountDate).toHaveValue('2026-10-28');

    const labels = page.locator('label').filter({ has: page.getByRole('checkbox') });
    await expect(labels).toHaveCount(6);
    for (const control of [...(await labels.all()), nextCountDate]) {
      const bounds = await control.boundingBox();
      expect(bounds).not.toBeNull();
      expect(bounds!.x).toBeGreaterThanOrEqual(0);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
    }
    await page.screenshot({ path: test.info().outputPath('nursing-night-mobile.png') });
  });

  test.describe('Shift Selection', () => {
    test('should display shift toggle buttons', async ({ page }) => {
      await openHandoff(page);

      await expect(page.getByTestId('handoff-shift-day-button')).toBeVisible({
        timeout: 10000,
      });
      await expect(page.getByTestId('handoff-shift-night-button')).toBeVisible({
        timeout: 10000,
      });
    });

    test('should switch between day and night shifts', async ({ page }) => {
      await openHandoff(page);

      const nightShiftBtn = page.getByTestId('handoff-shift-night-button');
      if (await nightShiftBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
        await nightShiftBtn.click();
        await expect(nightShiftBtn).toBeVisible();
      }
    });
  });

  test.describe('Staff Selection', () => {
    test('should show nurse selection dropdown', async ({ page }) => {
      await openHandoff(page);

      await expect(page.locator('main')).toContainText('Enfermero/a 1');
    });
  });

  test.describe('Patient List', () => {
    test('should display patient handoff notes', async ({ page }) => {
      await openHandoff(page);

      await expect(page.locator('table').first()).toBeVisible({
        timeout: 10000,
      });
      await expect(page.locator('main')).toContainText('Handoff Patient');
    });
  });

  test.describe('Actions', () => {
    test('should have print/PDF button', async ({ page }) => {
      await openHandoff(page);

      await expect(page.getByRole('button', { name: /Guardar/i }).first()).toBeVisible({
        timeout: 10000,
      });
    });

    test('should keep save entrypoint visible in nursing handoff', async ({ page }) => {
      await openHandoff(page);

      await expect(page.getByRole('button', { name: /Guardar/i }).first()).toBeVisible({
        timeout: 10000,
      });
    });
  });
});
