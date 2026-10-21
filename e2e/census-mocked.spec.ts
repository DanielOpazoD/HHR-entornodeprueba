/**
 * E2E Tests: Census View with Mocked Auth
 * Tests the census view functionality with seeded auth and daily records.
 */

import { test, expect, type Page } from '@playwright/test';
import {
  bootstrapSeededRecord,
  buildCanonicalE2ERecord,
  ensureAuthenticated,
} from './fixtures/auth';

const getTodayDate = () => new Date().toISOString().slice(0, 10);

const buildSeededCensusRecord = (date: string) =>
  buildCanonicalE2ERecord(date, {
    beds: {
      ...(buildCanonicalE2ERecord(date).beds as Record<string, unknown>),
      R1: {
        ...(buildCanonicalE2ERecord(date).beds as Record<string, Record<string, unknown>>).R1,
        patientName: 'Mock Patient',
        rut: '12345678-5',
        pathology: 'Mock Diagnosis',
        status: 'Estable',
        age: '45',
        admissionDate: date,
      },
    },
  });

const openSeededCensus = async (
  page: Page,
  role: 'editor' | 'viewer' = 'editor',
  forceEditableRecord = role === 'editor'
) => {
  const date = getTodayDate();
  await bootstrapSeededRecord(page, {
    role,
    date,
    record: buildSeededCensusRecord(date),
    useRuntimeOverride: true,
    forceEditableRecord,
  });
  await page.goto(`/censo?date=${date}`);
  await ensureAuthenticated(page);
  await expect(page.getByTestId('census-table')).toBeVisible({ timeout: 20000 });
};

test.describe('Census View (Authenticated)', () => {
  test.beforeEach(async ({ page }) => {
    await openSeededCensus(page, 'editor');
  });

  test('should display census view and loaded data', async ({ page }) => {
    const censusTable = page.getByTestId('census-table');
    await expect(censusTable).toBeVisible({ timeout: 10000 });

    const bedRows = page.locator('tbody tr');
    await expect(bedRows.first()).toBeVisible();
    expect(await bedRows.count()).toBeGreaterThan(0);
    await expect(page.locator('input[name="patientName"]').first()).toHaveValue('Mock Patient');
  });

  test('should show date navigation', async ({ page }) => {
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

  test('should display hospital capacity stats', async ({ page }) => {
    await expect(page.getByText('Censo Camas', { exact: true })).toBeVisible();
    await expect(page.getByText('Cap:', { exact: true })).toBeVisible();
    await expect(page.getByText('Ocu.', { exact: true })).toBeVisible();
  });
});

test.describe('Census View Permissions', () => {
  test('editor should have editable inputs', async ({ page }) => {
    await openSeededCensus(page, 'editor');

    const patientInput = page.locator('input[name="patientName"]').first();
    await expect(patientInput).toBeEditable({ timeout: 5000 });

    await patientInput.fill('E2E Test Patient');
    await expect(patientInput).toHaveValue('E2E Test Patient');
  });

  test('viewer should have readonly inputs', async ({ page }) => {
    await openSeededCensus(page, 'viewer', false);

    const patientInput = page.locator('input[name="patientName"]').first();
    await expect(patientInput).toHaveAttribute('readonly', '');
  });
});

test.describe('Export Functionality', () => {
  test('should have save/export entrypoint visible for editor', async ({ page }) => {
    await openSeededCensus(page, 'editor');

    await expect(page.getByRole('button', { name: /Guardar/i })).toBeVisible({ timeout: 10000 });
  });
});

test.describe('Logout Flow', () => {
  test('should clear session on logout when logout action is available', async ({ page }) => {
    await openSeededCensus(page, 'editor');

    const avatarButton = page.locator('nav button').last();
    if (await avatarButton.isVisible().catch(() => false)) {
      await avatarButton.click();
    }

    const logoutButton = page.getByRole('button', { name: /Cerrar sesión/i });
    if (!(await logoutButton.isVisible({ timeout: 2000 }).catch(() => false))) {
      test.skip();
      return;
    }

    await logoutButton.click();
    await expect(page.getByText(/Iniciar sesión/i)).toBeVisible({ timeout: 10000 });

    const afterLogout = await page.evaluate(() => localStorage.getItem('hhr_e2e_bootstrap_user'));
    expect(afterLogout).toBeNull();
  });
});
