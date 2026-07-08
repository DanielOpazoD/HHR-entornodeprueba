import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { setupE2EContext, ensureRecordExists } from './fixtures/auth';

const CURRENT_DATE = process.env.E2E_FIXED_DATE ?? new Date().toISOString().slice(0, 10);

const getPatientNameInput = (page: Page) =>
  page
    .getByTestId('census-table')
    .locator('tr')
    .filter({ hasText: 'R1' })
    .locator('input[name="patientName"]')
    .first();

const readNavigatorOnline = async (page: Page): Promise<boolean | null> => {
  try {
    return await page.evaluate(() => navigator.onLine);
  } catch (error) {
    const message = String((error as Error)?.message || error);
    if (message.includes('Execution context was destroyed')) {
      return null;
    }
    throw error;
  }
};

const bootstrapCensusSession = async (
  page: Page,
  role: 'admin' | 'viewer',
  options: { ensureEditableRecord?: boolean } = {}
) => {
  await setupE2EContext(page, role, true, CURRENT_DATE);
  await page.goto(`/censo?date=${CURRENT_DATE}`);
  if (options.ensureEditableRecord !== false) {
    await ensureRecordExists(page);
  }
  await expect(page.getByRole('main')).toBeVisible({ timeout: 15_000 });
};

test.describe('Critical Census Flows (Firestore emulator-backed runtime)', () => {
  test('renders census table with the seeded patient row', async ({ page }) => {
    test.setTimeout(60_000);
    await bootstrapCensusSession(page, 'admin');

    const input = getPatientNameInput(page);
    await expect(input).toBeVisible();
    await expect(input).toHaveValue(/MOCK PATIENT/i);
  });

  test('keeps the census workspace visible across offline -> online transitions', async ({
    page,
    context,
  }) => {
    test.setTimeout(60_000);

    await bootstrapCensusSession(page, 'admin');

    await expect(page.getByTestId('census-table')).toBeVisible();

    await context.setOffline(true);
    await expect.poll(() => readNavigatorOnline(page)).toBe(false);
    await expect(page.getByTestId('census-table')).toBeVisible();

    await context.setOffline(false);
    await expect.poll(() => readNavigatorOnline(page)).toBe(true);
    await page.waitForTimeout(500);

    await expect(page.getByTestId('census-table')).toBeVisible();
    await expect(page.getByRole('button', { name: /Guardar/i })).toBeVisible();
  });

  test('viewer role can reach the censo workspace without crashing', async ({ page }) => {
    test.setTimeout(60_000);
    await bootstrapCensusSession(page, 'viewer', { ensureEditableRecord: false });

    await expect(page.getByRole('main')).toBeVisible();
    const censusTable = page.getByTestId('census-table');
    const emptyDayPrompt = page.getByText(/No existe registro para esta fecha/i, {
      exact: false,
    });

    await expect
      .poll(async () => {
        if (await censusTable.isVisible().catch(() => false)) {
          return 'census-table';
        }
        if (await emptyDayPrompt.isVisible().catch(() => false)) {
          return 'empty-day-prompt';
        }
        return 'pending';
      })
      .toMatch(/census-table|empty-day-prompt/);
  });
});
