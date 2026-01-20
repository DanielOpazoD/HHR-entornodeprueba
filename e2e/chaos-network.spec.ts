import { test, expect } from '@playwright/test';
import { injectMockUser, injectMockData, ensureRecordExists } from './fixtures/auth';

/**
 * Chaos Test: Network Intermittency
 * Ensures that the app handles offline transitions gracefully without losing data.
 */
test.describe('Chaos Network Simulation', () => {
    test.beforeEach(async ({ page }) => {
        await injectMockUser(page, 'editor');
        await injectMockData(page);
        await ensureRecordExists(page);
    });

    test('should preserve data when switching between offline/online', async ({ page, context }) => {
        const bedRow = page.locator('tr:has-text("R1")');
        const nameInput = bedRow.locator('input[type="text"]').first();

        // 1. Initial State: Online
        await nameInput.fill('ONLINE_INITIAL');
        await nameInput.blur();

        // 2. Go Offline
        await context.setOffline(true);

        // We trigger a change to force the UI to react to offline state
        await nameInput.fill('OFFLINE_CHANGE');
        await nameInput.blur();

        // Verify UI reflects offline or at least doesn't crash
        await expect(nameInput).toHaveValue('OFFLINE_CHANGE');

        // 3. Go back Online
        await context.setOffline(false);

        // 4. Verify data remains and app is still functional
        await nameInput.fill('ONLINE_RESUMED');
        await nameInput.blur();

        await expect(nameInput).toHaveValue('ONLINE_RESUMED');

        // Refresh page to ensure LocalStorage persisted correctly
        await page.reload();
        await expect(nameInput).toHaveValue('ONLINE_RESUMED');
    });
});
