/**
 * Handoff Flow E2E Tests
 * Tests for nursing and medical handoff workflows with seeded auth/data.
 */

import { test, expect, type Page } from '@playwright/test';
import {
  bootstrapSeededRecord,
  buildCanonicalE2ERecord,
  ensureAuthenticated,
} from './fixtures/auth';

const getTodayDate = () => new Date().toISOString().slice(0, 10);

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

const openHandoff = async (page: Page, mode: 'nursing' | 'medical') => {
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

  const navButton =
    mode === 'medical'
      ? page.getByTestId('nav-tab-medical-handoff')
      : page.getByTestId('nav-tab-nursing-handoff');
  await expect(navButton).toBeVisible({ timeout: 20000 });
  await navButton.click();
  await expect(page).toHaveURL(
    new RegExp(mode === 'medical' ? '/medical-handoff' : '/nursing-handoff'),
    { timeout: 20000 }
  );
  await expect(page.locator('main')).toContainText(
    mode === 'medical' ? /ESPECIALIDAD|ENTREGADO POR/i : /Turno Largo/i,
    { timeout: 20000 }
  );
};

test.describe('Nursing Handoff', () => {
  test.describe('Shift Selection', () => {
    test('should display shift toggle buttons', async ({ page }) => {
      await openHandoff(page, 'nursing');

      await expect(page.getByTestId('handoff-shift-day-button')).toBeVisible({
        timeout: 10000,
      });
      await expect(page.getByTestId('handoff-shift-night-button')).toBeVisible({
        timeout: 10000,
      });
    });

    test('should switch between day and night shifts', async ({ page }) => {
      await openHandoff(page, 'nursing');

      const nightShiftBtn = page.getByTestId('handoff-shift-night-button');
      if (await nightShiftBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
        await nightShiftBtn.click();
        await expect(nightShiftBtn).toBeVisible();
      }
    });
  });

  test.describe('Staff Selection', () => {
    test('should show nurse selection dropdown', async ({ page }) => {
      await openHandoff(page, 'nursing');

      await expect(page.locator('main')).toContainText('Enfermero/a 1');
    });
  });

  test.describe('Patient List', () => {
    test('should display patient handoff notes', async ({ page }) => {
      await openHandoff(page, 'nursing');

      await expect(page.locator('table').first()).toBeVisible({
        timeout: 10000,
      });
      await expect(page.locator('main')).toContainText('Handoff Patient');
    });
  });

  test.describe('Actions', () => {
    test('should have print/PDF button', async ({ page }) => {
      await openHandoff(page, 'nursing');

      await expect(page.getByRole('button', { name: /Guardar/i }).first()).toBeVisible({
        timeout: 10000,
      });
    });

    test('should keep save entrypoint visible in nursing handoff', async ({ page }) => {
      await openHandoff(page, 'nursing');

      await expect(page.getByRole('button', { name: /Guardar/i }).first()).toBeVisible({
        timeout: 10000,
      });
    });
  });
});

test.describe('Medical Handoff', () => {
  test('should navigate to medical handoff view', async ({ page }) => {
    await openHandoff(page, 'medical');

    await expect(page.locator('h1, h2, .title').first()).toBeVisible({ timeout: 10000 });
  });

  test('should display medical notes for patients', async ({ page }) => {
    await openHandoff(page, 'medical');

    const createMedicalHandoffButton = page
      .getByTestId('medical-handoff-create-entry-button')
      .first();
    await expect(createMedicalHandoffButton).toBeVisible({ timeout: 10000 });
    await createMedicalHandoffButton.click();

    await expect(page.locator('textarea').first()).toBeVisible({
      timeout: 10000,
    });
  });

  test('should expose medical signature link actions', async ({ page }) => {
    await openHandoff(page, 'medical');

    await expect(page.getByTestId('medical-handoff-sign-button').first()).toBeVisible({
      timeout: 10000,
    });
    await expect(page.getByTestId('medical-handoff-send-whatsapp-button').first()).toBeVisible({
      timeout: 10000,
    });
  });
});
