import { test, expect } from '@playwright/test';
import { setupE2EContext, ensureRecordExists } from './fixtures/auth';

/**
 * E2E Test: Complete Day Workflow
 * Simulates a full hospital day: Login -> Load data -> Shift change -> Logout
 */

test.describe('Complete Hospital Day E2E', () => {
    test('should complete a full hospital day workflow', async ({ page }) => {
        // 1. SETUP CONTEXT (Auth + Data + Single Reload)
        await setupE2EContext(page, 'admin');
        await ensureRecordExists(page);

        // 2. Verify table loaded
        const table = page.getByTestId('census-table');
        await expect(table).toBeVisible({ timeout: 15000 });

        // 3. ADD PATIENT DATA
        // Using a more specific selector for the first patient name input
        const nameInput = table.locator('input[type="text"]').first();
        await expect(nameInput).toBeVisible();
        await nameInput.clear();
        await nameInput.fill('PACIENTE WORKFLOW');
        await nameInput.press('Enter');

        // 4. NAVIGATE TO NURSING HANDOFF
        await page.getByRole('button', { name: 'Entrega Turno Enfermería' }).click();
        await expect(page.locator('h2').first()).toBeVisible({ timeout: 10000 });

        // 5. NAVIGATE TO MEDICAL HANDOFF
        await page.getByRole('button', { name: 'Entrega Turno Médicos' }).click();
        await expect(page.locator('h2').first()).toBeVisible({ timeout: 10000 });

        // 6. NAVIGATE BACK TO CENSUS
        await page.getByRole('button', { name: 'Censo Diario' }).click();
        await expect(table).toBeVisible({ timeout: 10000 });
    });

    test('should prevent unauthorized access (viewer role)', async ({ page }) => {
        await setupE2EContext(page, 'viewer', true);
        await ensureRecordExists(page);

        const table = page.getByTestId('census-table');
        await expect(table).toBeVisible({ timeout: 15000 });

        // Inputs should be disabled for viewer
        const patientInput = table.locator('input[type="text"]').first();
        await expect(patientInput).toBeDisabled({ timeout: 5000 });
    });
});
