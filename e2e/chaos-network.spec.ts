import { test, expect } from '@playwright/test';
import {
  bootstrapSeededRecord,
  buildCanonicalE2ERecord,
  ensureAuthenticated,
} from './fixtures/auth';
import { getTodayISO } from '../src/utils/dateCoreUtils';

/**
 * Chaos Test: Network Intermittency
 * Ensures that the app handles offline transitions gracefully without losing data.
 */

const getTodayDate = () => getTodayISO();

const buildChaosRecord = (date: string) =>
  buildCanonicalE2ERecord(date, {
    beds: {
      ...(buildCanonicalE2ERecord(date).beds as Record<string, unknown>),
      R1: {
        ...(buildCanonicalE2ERecord(date).beds as Record<string, Record<string, unknown>>).R1,
        patientName: 'CHAOS_BASE',
        pathology: 'Chaos DX',
        status: 'Estable',
      },
    },
  });

test.describe('Chaos Network Simulation', () => {
  test.beforeEach(async ({ page }) => {
    const date = getTodayDate();
    await bootstrapSeededRecord(page, {
      role: 'editor',
      date,
      record: buildChaosRecord(date),
      useRuntimeOverride: true,
      forceEditableRecord: true,
    });
    await page.goto(`/censo?date=${date}`);
    await ensureAuthenticated(page);
    await expect(page.getByTestId('census-table')).toBeVisible({ timeout: 20000 });
  });

  test('should preserve data when switching between offline/online', async ({ page, context }) => {
    const getNameInput = () => page.locator('input[name="patientName"]').first();
    const nameInput = getNameInput();
    await expect(nameInput).toBeEditable({ timeout: 10000 });

    await nameInput.fill('ONLINE_INITIAL');
    await nameInput.blur();

    await context.setOffline(true);
    const offlineInput = getNameInput();
    await offlineInput.fill('OFFLINE_CHANGE');
    await offlineInput.blur();
    await expect(offlineInput).toHaveValue('Offline_change');

    await context.setOffline(false);
    const resumedInput = getNameInput();
    await resumedInput.fill('ONLINE_RESUMED');
    await resumedInput.blur();
    await expect(resumedInput).toHaveValue('Online_resumed');

    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('census-table')).toBeVisible({ timeout: 15000 });

    const refreshedInput = page.locator('input[name="patientName"]').first();
    await expect(refreshedInput).toHaveValue('Online_resumed', { timeout: 10000 });
  });
});
