/**
 * E2E Tests: Date Navigation & Data Entry
 * Tests date switching and patient data entry workflows with seeded current-date records.
 */

import { test, expect } from '@playwright/test';
import {
  bootstrapSeededRecord,
  buildCanonicalE2ERecord,
  ensureAuthenticated,
} from './fixtures/auth';
import { getTodayISO } from '../src/utils/dateCoreUtils';

const getTodayDate = () => getTodayISO();

const buildComprehensiveRecord = (date: string) =>
  buildCanonicalE2ERecord(date, {
    beds: {
      ...(buildCanonicalE2ERecord(date).beds as Record<string, unknown>),
      R1: {
        ...(buildCanonicalE2ERecord(date).beds as Record<string, Record<string, unknown>>).R1,
        patientName: 'Comprehensive Patient',
        pathology: 'Comp DX',
        status: 'Estable',
      },
    },
  });

const openSeededCensus = async (page: import('@playwright/test').Page) => {
  const date = getTodayDate();
  await bootstrapSeededRecord(page, {
    role: 'editor',
    date,
    record: buildComprehensiveRecord(date),
    useRuntimeOverride: true,
    forceEditableRecord: true,
  });
  await page.goto(`/censo?date=${date}`);
  await ensureAuthenticated(page);
  await expect(page.getByTestId('census-table')).toBeVisible({ timeout: 20000 });
};

test.describe('Date Navigation', () => {
  test.beforeEach(async ({ page }) => {
    await openSeededCensus(page);
  });

  test('should display current month and year', async ({ page }) => {
    const today = new Date();
    const monthNames = [
      'Enero',
      'Febrero',
      'Marzo',
      'Abril',
      'Mayo',
      'Junio',
      'Julio',
      'Agosto',
      'Septiembre',
      'Octubre',
      'Noviembre',
      'Diciembre',
    ];
    const currentMonthName = monthNames[today.getMonth()];

    await expect(page.getByText(currentMonthName, { exact: true }).first()).toBeVisible();
    await expect(
      page.getByText(String(today.getFullYear()), { exact: true }).first()
    ).toBeVisible();
  });

  test('should have navigation buttons for days', async ({ page }) => {
    const today = new Date().getDate();
    await expect(page.getByRole('button', { name: String(today) }).first()).toBeVisible();
  });
});

test.describe('Patient Data Entry', () => {
  test.beforeEach(async ({ page }) => {
    await openSeededCensus(page);
  });

  test('should allow typing in patient data fields', async ({ page }) => {
    const nameInput = page.locator('input[name="patientName"]').first();
    await expect(nameInput).toBeEditable({ timeout: 10000 });

    await nameInput.fill('JUAN PEREZ');
    await expect(nameInput).toHaveValue('JUAN PEREZ');
  });

  test('should keep save entrypoint visible after typing', async ({ page }) => {
    const nameInput = page.locator('input[name="patientName"]').first();
    await expect(nameInput).toBeEditable({ timeout: 10000 });

    await nameInput.fill('Auto Save Test');
    await nameInput.blur();

    await expect(page.getByRole('button', { name: /Guardar/i })).toBeVisible({ timeout: 10000 });
  });
});

test.describe('Mobile Responsiveness', () => {
  test('should render correctly on iPhone viewport', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await openSeededCensus(page);

    const root = page.locator('#root');
    await expect(root).toBeVisible();
    await expect(page.getByTestId('census-table')).toBeVisible();
  });
});
