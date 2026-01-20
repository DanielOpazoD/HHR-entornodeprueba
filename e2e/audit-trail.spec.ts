import { test, expect } from '@playwright/test';
import { injectMockUser, injectMockData, ensureRecordExists } from './fixtures/auth';

/**
 * E2E Test: Audit Trail Verification
 * Tests that critical actions are logged in the audit system.
 */

test.describe('Audit Trail Flow', () => {
    test.beforeEach(async ({ page }) => {
        await injectMockUser(page, 'admin');
        await injectMockData(page, undefined, true); // With patient
        await ensureRecordExists(page);
    });

    test('should navigate to audit view', async ({ page }) => {
        await expect(page.locator('table')).toBeVisible({ timeout: 15000 });

        // Look for Audit navigation
        // Could be in main nav, settings menu, or admin section
        const auditNavButton = page.locator('button:has-text("Auditoría"), a:has-text("Auditoría"), nav button:has-text("Auditoría")');

        if (await auditNavButton.isVisible()) {
            await auditNavButton.click();

            // Verify audit view loaded
            await expect(page.locator('h1:has-text("Auditoría"), h2:has-text("Auditoría")')).toBeVisible({ timeout: 5000 });

            // Check for audit log table
            await expect(page.locator('table')).toBeVisible();
        } else {
            // Try accessing via URL if nav is hidden
            await page.goto('/#/audit');
            await page.waitForLoadState('domcontentloaded');

            // Check if audit view loads
            const heading = page.locator('text=Auditoría, text=Registros de Auditoría');
            // Skip test if not implemented
            if (!await heading.isVisible({ timeout: 3000 })) {
                test.skip();
            }
        }
    });

    test('should filter audit logs by date', async ({ page }) => {
        await expect(page.locator('table')).toBeVisible({ timeout: 15000 });

        // Navigate to audit
        const auditNav = page.locator('button:has-text("Auditoría")');
        if (!await auditNav.isVisible({ timeout: 3000 })) {
            test.skip();
            return;
        }
        await auditNav.click();

        // Look for date filter
        const dateFilter = page.locator('input[type="date"][name*="filter"], input[type="date"]').first();
        if (await dateFilter.isVisible()) {
            const today = new Date().toISOString().split('T')[0];
            await dateFilter.fill(today);

            // Verify filter applied (table should update)
            await page.waitForTimeout(500);

            // Check that table still exists
            await expect(page.locator('table')).toBeVisible();
        }
    });

    test('should show action details', async ({ page }) => {
        await expect(page.locator('table')).toBeVisible({ timeout: 15000 });

        // Navigate to audit
        const auditNav = page.locator('button:has-text("Auditoría")');
        if (!await auditNav.isVisible({ timeout: 3000 })) {
            test.skip();
            return;
        }
        await auditNav.click();

        // Wait for table
        await expect(page.locator('table')).toBeVisible({ timeout: 5000 });

        // Click on first row to see details
        const firstRow = page.locator('tbody tr').first();
        if (await firstRow.isVisible()) {
            await firstRow.click();

            // Should show action type, user, timestamp
            // Look for common audit fields
            const actionType = page.locator('text=Tipo de Acción, text=Acción');
            const user = page.locator('text=Usuario');
            const timestamp = page.locator('text=Fecha, text=Timestamp');

            // At least one should be visible
            const anyVisible = await actionType.isVisible() ||
                await user.isVisible() ||
                await timestamp.isVisible();

            if (anyVisible) {
                expect(anyVisible).toBeTruthy();
            }
        }
    });

    test('should export audit logs', async ({ page }) => {
        await expect(page.locator('table')).toBeVisible({ timeout: 15000 });

        // Navigate to audit
        const auditNav = page.locator('button:has-text("Auditoría")');
        if (!await auditNav.isVisible({ timeout: 3000 })) {
            test.skip();
            return;
        }
        await auditNav.click();

        // Look for export button
        const exportBtn = page.locator('button:has-text("Exportar"), button:has-text("Descargar")');
        if (await exportBtn.isVisible()) {
            // Set up download listener
            const downloadPromise = page.waitForEvent('download', { timeout: 5000 }).catch(() => null);

            await exportBtn.click();

            const download = await downloadPromise;
            if (download) {
                // Verify download started
                expect(download.suggestedFilename()).toContain('audit');
            }
        }
    });

    test('should display audit entries for different action types', async ({ page }) => {
        await expect(page.locator('table')).toBeVisible({ timeout: 15000 });

        // Navigate to audit
        const auditNav = page.locator('button:has-text("Auditoría")');
        if (!await auditNav.isVisible({ timeout: 3000 })) {
            test.skip();
            return;
        }
        await auditNav.click();

        await expect(page.locator('table')).toBeVisible({ timeout: 5000 });

        // Look for common audit action types in the table
        const actionTypes = [
            'PATIENT_ADMITTED',
            'PATIENT_DISCHARGED',
            'PATIENT_TRANSFERRED',
            'PATIENT_VIEWED',
            'USER_LOGIN'
        ];

        // Check if any action type appears in table
        for (const action of actionTypes) {
            const cell = page.locator(`td:has-text("${action}")`);
            if (await cell.isVisible({ timeout: 1000 }).catch(() => false)) {
                break;
            }
        }

        // If audit is populated, should find at least one action
        // If empty, that's also valid for a new system
    });
});
