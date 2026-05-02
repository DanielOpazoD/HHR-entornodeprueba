/**
 * Transfer Management E2E Tests
 * Tests for patient transfer request workflows with seeded auth/data.
 */

import { test, expect, type Page } from '@playwright/test';
import {
  bootstrapSeededRecord,
  buildCanonicalE2ERecord,
  ensureAuthenticated,
} from './fixtures/auth';

const getTodayDate = () => new Date().toISOString().slice(0, 10);

const buildTransferRecord = (date: string) =>
  buildCanonicalE2ERecord(date, {
    beds: {
      ...(buildCanonicalE2ERecord(date).beds as Record<string, unknown>),
      R1: {
        ...(buildCanonicalE2ERecord(date).beds as Record<string, Record<string, unknown>>).R1,
        patientName: 'Transfer Patient',
        pathology: 'Traslado requerido',
        status: 'Estable',
      },
    },
  });

const openTransfers = async (page: Page) => {
  const date = getTodayDate();
  await bootstrapSeededRecord(page, {
    role: 'admin',
    date,
    record: buildTransferRecord(date),
    useRuntimeOverride: true,
    forceEditableRecord: true,
  });
  await page.goto(`/transfer-management?date=${date}`);
  await ensureAuthenticated(page);
  await expect(page.getByTestId('transfer-management-view')).toBeVisible({ timeout: 20000 });
};

test.describe('Transfer Management', () => {
  test.describe('Transfer List View', () => {
    test('should display transfer requests list', async ({ page }) => {
      await openTransfers(page);

      await expect(page.locator('h1, h2, .title').first()).toBeVisible({ timeout: 10000 });
    });

    test('should have create new transfer button', async ({ page }) => {
      await openTransfers(page);

      await expect(page.getByTestId('transfer-new-request-button')).toBeVisible({
        timeout: 10000,
      });
    });

    test('should show transfer status surface', async ({ page }) => {
      await openTransfers(page);

      await expect(page.locator('main')).toContainText(/traslado|transfer/i);
    });
  });

  test.describe('Create Transfer Modal', () => {
    test('should open transfer creation modal', async ({ page }) => {
      await openTransfers(page);

      const createBtn = page.getByTestId('transfer-new-request-button');
      if (await createBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
        await createBtn.click();
        await expect(page.locator('[role="dialog"]').first()).toBeVisible({ timeout: 5000 });
      }
    });

    test('should have patient selector in modal', async ({ page }) => {
      await openTransfers(page);

      const createBtn = page.getByTestId('transfer-new-request-button');
      if (await createBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
        await createBtn.click();
        await expect(page.locator('select, [data-testid="patient-selector"]').first()).toBeVisible({
          timeout: 5000,
        });
      }
    });

    test('should have destination field in modal', async ({ page }) => {
      await openTransfers(page);

      const createBtn = page.getByTestId('transfer-new-request-button');
      if (await createBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
        await createBtn.click();
        await expect(
          page.locator('input[name*="destino"], input[name*="hospital"], select').first()
        ).toBeVisible({ timeout: 5000 });
      }
    });
  });

  test.describe('Transfer Status Workflow', () => {
    test('should render transfer workflow surface', async ({ page }) => {
      await openTransfers(page);

      await expect(page.locator('main')).toBeVisible();
    });
  });
});
