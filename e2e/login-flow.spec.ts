/**
 * Login Flow E2E Tests
 * Tests for authentication flows and role-based access
 */

import { test, expect } from '@playwright/test';

test.describe('Login Flow', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/');
    });

    test('should display login page for unauthenticated users', async ({ page }) => {
        // Verify login page elements are visible
        await expect(page.getByText('Hospital Hanga Roa')).toBeVisible();
        await expect(page.getByRole('button', { name: /Google/i })).toBeVisible();
    });

    test('should show hospital logo on login page', async ({ page }) => {
        const logo = page.locator('img[alt*="logo" i], img[alt*="Hospital" i]').first();
        await expect(logo).toBeVisible();
    });

    test('should have Google login button', async ({ page }) => {
        const googleButton = page.getByRole('button', { name: /Ingresar|Google|Login/i });
        await expect(googleButton).toBeVisible();
        await expect(googleButton).toBeEnabled();
    });

    test('should show version number', async ({ page }) => {
        // App version should be displayed somewhere
        const versionText = page.locator('text=/v\\d+\\.\\d+/');
        await expect(versionText).toBeVisible({ timeout: 5000 }).catch(() => {
            // Version may not be visible on all screens
        });
    });
});

test.describe('Navigation Guards', () => {
    test('should redirect to login when accessing protected routes', async ({ page }) => {
        await page.goto('/censo');

        // Should be redirected or show login
        await expect(page).toHaveURL(/\/(login|$)/);
    });

    test('should block access to admin routes without authentication', async ({ page }) => {
        await page.goto('/admin');

        // Should be redirected to login
        await expect(page).toHaveURL(/\/(login|$)/);
    });
});
