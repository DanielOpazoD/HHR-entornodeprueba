import { test, expect, type Page } from '@playwright/test';
import {
  bootstrapSeededRecord,
  buildCanonicalE2ERecord,
  ensureAuthenticated,
} from './fixtures/auth';
import { getTodayISO } from '../src/utils/dateCoreUtils';

const getTodayDate = () => getTodayISO();

const buildOfflineRecord = (date: string) =>
  buildCanonicalE2ERecord(date, {
    beds: {
      ...(buildCanonicalE2ERecord(date).beds as Record<string, unknown>),
      R1: {
        ...(buildCanonicalE2ERecord(date).beds as Record<string, Record<string, unknown>>).R1,
        patientName: 'Offline Seed',
        pathology: 'Offline DX',
        status: 'Estable',
      },
    },
  });

const openSeededCensus = async (page: Page) => {
  const date = getTodayDate();
  await bootstrapSeededRecord(page, {
    role: 'editor',
    date,
    record: buildOfflineRecord(date),
    useRuntimeOverride: true,
    forceEditableRecord: true,
  });
  await page.goto(`/censo?date=${date}`);
  await ensureAuthenticated(page);
  await expect(page.getByTestId('census-table')).toBeVisible({ timeout: 20000 });
};

test.describe('Mocked Offline Network Scenarios', () => {
  test('should keep a local pending save visible on firestore connectivity failure', async ({
    page,
  }) => {
    await page.route('**/*firestore.googleapis.com/**', route =>
      route.abort('internetdisconnected')
    );

    await openSeededCensus(page);

    const nameInput = page.locator('input[name="patientName"]').first();
    await expect(nameInput).toBeEditable({ timeout: 10000 });

    await nameInput.fill('OFFLINE MOCK TEST');
    await nameInput.blur();

    await expect(page.getByText(/guardando/i).first()).toBeVisible({ timeout: 10000 });
    await expect(nameInput).toHaveValue(/offline mock test/i);

    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('census-table')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('input[name="patientName"]').first()).toHaveValue(
      /offline mock test/i
    );
  });

  test('should keep the optimistic UI stable upon save rejection (403 or specific error)', async ({
    page,
  }) => {
    await page.route('**/*firestore.googleapis.com/**/documents/dailyRecords/**', async route => {
      if (route.request().method() === 'PATCH' || route.request().method() === 'POST') {
        await route.fulfill({
          status: 403,
          contentType: 'application/json',
          body: JSON.stringify({
            error: { message: 'Permission denied', status: 'PERMISSION_DENIED' },
          }),
        });
        return;
      }
      await route.continue();
    });

    await openSeededCensus(page);

    const nameInput = page.locator('input[name="patientName"]').first();
    const initialValue = await nameInput.inputValue();

    await nameInput.fill('SHOULD ROLLBACK');
    await nameInput.blur();

    await expect(page.locator('input[name="patientName"]').first()).toHaveValue(/should rollback/i);
    await expect(page.getByRole('button', { name: /Guardar/i })).toBeVisible({ timeout: 10000 });
    await expect(page.locator('input[name="patientName"]').first()).not.toHaveValue(initialValue);
  });
});
