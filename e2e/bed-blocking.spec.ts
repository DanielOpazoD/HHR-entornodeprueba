import { test, expect } from '@playwright/test';
import {
  bootstrapSeededRecord,
  buildCanonicalE2ERecord,
  ensureAuthenticated,
} from './fixtures/auth';
import { getTodayISO } from '../src/utils/dateCoreUtils';

/**
 * E2E Test: Bed Blocking/Unblocking Flow
 * Tests the process of blocking and unblocking hospital beds.
 */

test.describe('Bed Blocking Flow', () => {
  test.beforeEach(async ({ page }) => {
    const date = getTodayISO();
    await bootstrapSeededRecord(page, {
      role: 'admin',
      date,
      record: buildCanonicalE2ERecord(date),
      useRuntimeOverride: true,
    });
    await page.goto(`/censo?date=${date}`);
    await ensureAuthenticated(page);
    await expect(page.getByTestId('census-table')).toBeVisible({ timeout: 20000 });
  });

  const getModalByTitle = (page: import('@playwright/test').Page, title: RegExp | string) =>
    page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: title }) });

  test('should block an empty bed', async ({ page }) => {
    // 1. Wait for table
    await expect(page.getByTestId('census-table')).toBeVisible({ timeout: 15000 });

    // 2. Open BedManager
    // The button is located in the DateStrip component with title "Bloqueo de camas" or text "Camas"
    const manageBedsBtn = page.locator('button[title="Bloqueo de camas"]');
    await expect(manageBedsBtn).toBeVisible();
    await manageBedsBtn.click();

    // 3. Wait for modal
    const modal = getModalByTitle(page, /Gestión de Camas/i);
    await expect(modal).toBeVisible({ timeout: 5000 });

    // 4. Click the bed button to block it (e.g. H1C1)
    const bedBtn = modal.getByRole('button', { name: /Gestionar cama H1C1/i });
    await bedBtn.dispatchEvent('click');

    // 5. Expect SubDialog
    const subDialog = getModalByTitle(page, /Bloquear Cama H1C1/i);
    await expect(subDialog).toBeVisible();

    // 6. Enter reason and confirm
    const reasonInput = subDialog.locator('input[type="text"]');
    await reasonInput.fill('Mantenimiento');

    await reasonInput.press('Enter');

    // 7. Verify the transient dialog clears.
    await expect(subDialog).not.toBeVisible({ timeout: 15000 });

    // 8. Close main modal and verify the row reflects the blocked state.
    await page.keyboard.press('Escape');
    const bedRow = page.locator('tr').filter({ hasText: 'H1C1' }).first();
    await expect(bedRow).toContainText('Cama Bloqueada', { timeout: 15000 });
  });

  test('should not allow patient admission to blocked bed', async ({ page }) => {
    // 1. Block bed H2C1
    const manageBedsBtn = page.locator('button[title="Bloqueo de camas"]');
    await expect(manageBedsBtn).toBeVisible();
    await manageBedsBtn.click();

    const modal = getModalByTitle(page, /Gestión de Camas/i);
    await expect(modal).toBeVisible();

    const bedBtn = modal.getByRole('button', { name: /Gestionar cama H2C1/i });
    await bedBtn.dispatchEvent('click');

    const subDialog = getModalByTitle(page, /Bloquear Cama H2C1/i);
    await subDialog.locator('input[type="text"]').fill('Aislamiento');
    await subDialog.locator('input[type="text"]').press('Enter'); // Access via keyboard for speed/reliability

    await expect(bedBtn).toHaveClass(/amber-50/, { timeout: 15000 });
    await expect(subDialog).not.toBeVisible({ timeout: 15000 });
    await page.keyboard.press('Escape'); // Close manager

    // 2. Try to click the blocked bed row
    const bedRow = page.locator('tr').filter({ hasText: 'H2C1' }).first();
    await expect(bedRow).toBeVisible();

    // Verify visual indication
    await expect(bedRow).toHaveClass(/bg-slate-50\/50/); // Blocked style from PatientRow
    await expect(bedRow).toContainText('Cama Bloqueada');

    // Click it - should NOT open demographics or inputs
    await bedRow.click();

    // Ensure no input appears (inputs are replaced by the blocked message)
    const patientInput = bedRow.locator('input[name="patientName"]');
    await expect(patientInput).not.toBeVisible();

    // Ensure no modal appeared
    const demographics = page.locator('[role="dialog"]').filter({ hasText: 'Datos Demográficos' });
    await expect(demographics).not.toBeVisible();
  });

  test('should unblock a blocked bed', async ({ page }) => {
    const manageBedsBtn = page.locator('button[title="Bloqueo de camas"]');
    await expect(manageBedsBtn).toBeVisible();
    await manageBedsBtn.click();

    const modal = getModalByTitle(page, /Gestión de Camas/i);
    await expect(modal).toBeVisible();

    const bedBtn = modal.getByRole('button', { name: /Gestionar cama H3C1/i });

    // Block it
    await bedBtn.dispatchEvent('click');
    const subDialog = getModalByTitle(page, /Bloquear Cama H3C1/i);
    await subDialog.locator('input[type="text"]').fill('Test Block');
    await subDialog.locator('input[type="text"]').press('Enter');
    await expect(bedBtn).toHaveClass(/amber-50/, { timeout: 15000 });
    await expect(subDialog).not.toBeVisible({ timeout: 15000 });

    // Click again to Unblock/Edit
    await bedBtn.dispatchEvent('click');

    // Expect Edit dialog
    const editDialog = getModalByTitle(page, /Editar Cama H3C1/i);
    await expect(editDialog).toBeVisible();

    // Click Unblock using dispatchEvent to bypass potential overlay issues
    const unblockBtn = editDialog.getByRole('button', { name: 'Desbloquear Cama' });
    await expect(unblockBtn).toBeVisible();
    await unblockBtn.dispatchEvent('click');

    // Verify unblocked state
    await expect(editDialog).not.toBeVisible({ timeout: 15000 });
    await expect(bedBtn).not.toHaveClass(/amber-50/);
  });

  test('should show blocking reason', async ({ page }) => {
    // Block H4C1 with specific reason
    const manageBedsBtn = page.locator('button[title="Bloqueo de camas"]');
    await manageBedsBtn.click();
    const modal = getModalByTitle(page, /Gestión de Camas/i);

    const bedBtn = modal.getByRole('button', { name: /Gestionar cama H4C1/i });
    await bedBtn.click();

    const subDialog = getModalByTitle(page, /Bloquear Cama H4C1/i);
    const reason = 'Falla Eléctrica';
    await subDialog.locator('input[type="text"]').fill(reason);
    await subDialog.locator('input[type="text"]').press('Enter');
    await page.keyboard.press('Escape');

    // Check row
    const bedRow = page.locator('tr').filter({ hasText: 'H4C1' }).first();
    await expect(bedRow).toContainText(reason);
  });
});
