/**
 * E2E Tests: Census View with Mocked Auth
 * Tests the census view functionality with mock authentication and data.
 */

import { test, expect, Page } from '@playwright/test';
import { injectMockUser, injectMockData } from './fixtures/auth';

/**
 * Helper to ensure a record exists for current day
 * Clicks "Registro en Blanco" if the empty day screen is shown
 */
async function ensureRecordExists(page: Page) {
    // Wait for page to stabilize
    await page.waitForTimeout(500);

    // Check if we're on the empty day screen
    const blankRecordBtn = page.locator('button:has-text("Registro en Blanco")');
    const copyPreviousBtn = page.locator('button:has-text("Copiar del Anterior")');
    const table = page.locator('table');

    // If table already visible, we're good
    if (await table.isVisible({ timeout: 1000 }).catch(() => false)) {
        return;
    }

    // If blank record button visible, click it
    if (await blankRecordBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
        await blankRecordBtn.click();
        await page.waitForTimeout(1000);
        await table.waitFor({ state: 'visible', timeout: 15000 });
        return;
    }

    // Try copy from previous if no blank record button
    if (await copyPreviousBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
        await copyPreviousBtn.click();
        await page.waitForTimeout(1000);
        await table.waitFor({ state: 'visible', timeout: 15000 });
    }
}

test.describe('Census View (Authenticated)', () => {
    test.beforeEach(async ({ page }) => {
        // Inject mock editor user (handles navigation + reload)
        await injectMockUser(page, 'editor');
        // Inject mock data (handles reload)
        await injectMockData(page);
        // Ensure record exists
        await ensureRecordExists(page);
    });

    test('should display census view and loaded data', async ({ page }) => {
        // Should see the census table
        const censusTable = page.locator('table');
        await expect(censusTable).toBeVisible({ timeout: 10000 });

        // Verify beds are visible (at least some rows)
        const bedRows = page.locator('tbody tr');
        const count = await bedRows.count();
        expect(count).toBeGreaterThan(0);
    });

    test('should show date navigation', async ({ page }) => {
        const today = new Date();
        const monthNames = [
            "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
            "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"
        ];
        const currentMonthName = monthNames[today.getMonth()];

        await expect(page.locator(`text=${currentMonthName}`).first()).toBeVisible();
        await expect(page.locator(`text=${today.getFullYear()}`).first()).toBeVisible();
    });

    test('should display hospital capacity stats', async ({ page }) => {
        // Stats should be visible (may have different text)
        const statsArea = page.locator('main');
        await expect(statsArea).toBeVisible();

        // Check for any numeric stats
        const statNumbers = page.locator('text=/\\d+/');
        const count = await statNumbers.count();
        expect(count).toBeGreaterThan(0);
    });
});

test.describe('Census View Permissions', () => {
    test('editor should have editable inputs', async ({ page }) => {
        await injectMockUser(page, 'editor');
        await injectMockData(page);
        await ensureRecordExists(page);

        // Wait for table
        await page.locator('table').waitFor({ state: 'visible', timeout: 10000 });

        // Find any text input in the table
        const anyInput = page.locator('table input[type="text"]').first();
        await expect(anyInput).toBeEnabled({ timeout: 5000 });

        // Type something
        await anyInput.fill('E2E Test Patient');
        await expect(anyInput).toHaveValue('E2E Test Patient');
    });

    test('viewer should have disabled inputs', async ({ page }) => {
        await injectMockUser(page, 'viewer');
        await injectMockData(page);
        await ensureRecordExists(page);

        // Wait for table
        await page.locator('table').waitFor({ state: 'visible', timeout: 10000 });

        // Find any text input - should be disabled for viewer
        const anyInput = page.locator('table input[type="text"]').first();
        await expect(anyInput).toBeDisabled({ timeout: 5000 });
    });
});

test.describe('Export Functionality', () => {
    test('should have export button visible for editor', async ({ page }) => {
        await injectMockUser(page, 'editor');
        await injectMockData(page);

        // Look for export buttons (visible even without record)
        const exportButton = page.locator('button:has-text("EXCEL")');
        await expect(exportButton).toBeVisible({ timeout: 10000 });
    });
});

test.describe('Logout Flow', () => {
    test('should clear session on logout', async ({ page }) => {
        await injectMockUser(page, 'editor');
        await injectMockData(page);

        // Find logout button (in user menu or navbar)
        const userMenuBtn = page.locator('nav button').last();
        if (await userMenuBtn.isVisible()) {
            await userMenuBtn.click();
            await page.waitForTimeout(500);
        }

        const logoutButton = page.locator('button:has-text("Cerrar sesión"), button:has(svg.lucide-log-out)').first();

        if (await logoutButton.isVisible({ timeout: 2000 }).catch(() => false)) {
            await logoutButton.click();

            // Should redirect to login page
            await expect(page.locator('text=Acceso al Sistema')).toBeVisible({ timeout: 10000 });

            // localStorage should be cleared
            const afterLogout = await page.evaluate(() => localStorage.getItem('hhr_offline_user'));
            expect(afterLogout).toBeNull();
        }
    });
});
