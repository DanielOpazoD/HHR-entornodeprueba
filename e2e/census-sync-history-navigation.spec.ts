import { expect, test, type Page } from '@playwright/test';
import { buildCanonicalE2ERecord, MOCK_USERS } from './fixtures/auth';
import { installPreviewFirebaseRuntime } from './fixtures/previewFirebase';

// Keep synthetic network fixtures independent of previously registered PWA workers.
test.use({ serviceWorkers: 'block' });

const DATE = '2026-09-27';
const PRIOR_DATE = '2026-09-26';
const CODE = 'HHR-SYNC-1/vitals/source_timeout';

const seedHistory = async (page: Page) => {
  const config = await installPreviewFirebaseRuntime(page);
  // Backup listing is unrelated to the synthetic census navigation fixture.
  await page.route('https://firebasestorage.googleapis.com/**', route =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ items: [], prefixes: [] }),
    })
  );

  const makeRecord = (date: string, bedId: string, patientName: string) => {
    const base = buildCanonicalE2ERecord(date);
    const beds = base.beds as Record<string, Record<string, unknown>>;
    return buildCanonicalE2ERecord(date, {
      beds: {
        ...beds,
        [bedId]: {
          ...beds[bedId],
          patientName,
          rut: '12345678-5',
          admissionDate: date,
          clinicalEpisodeId: 'synthetic-navigation-episode',
          specialty: 'Medicina Interna',
        },
      },
    });
  };
  const current = makeRecord(DATE, 'H5C2', 'PACIENTE SINTÉTICO ACTUAL');
  current.rayenSyncHistory = [
    {
      id: 'synthetic-navigation-run',
      sourceDate: DATE,
      startedAt: '2026-09-28T03:00:00Z',
      completedAt: '2026-09-28T03:01:00Z',
      by: 'Operador sintético',
      status: 'partial',
      coverage: {
        total: 1,
        completed: 0,
        errors: 1,
        sourceErrors: 3,
        completedAt: '2026-09-28T03:01:00Z',
        issues: [
          { bedId: 'H5C2', source: 'vitals', reason: 'source_timeout' },
          { bedId: 'R4', source: 'devices', reason: 'source_unavailable' },
          { bedId: 'H5C2', source: 'cudyr', reason: 'historical_archive_failed' },
        ],
      },
    },
  ];
  // A transfer makes the historical bed differ from the current one.
  const records = {
    [DATE]: current,
    [PRIOR_DATE]: makeRecord(PRIOR_DATE, 'R2', 'PACIENTE SINTÉTICO PREVIO'),
  };
  await page.addInitScript(
    ({ records, config, user }) => {
      (window as Window & { __HHR_E2E_OVERRIDE__?: Record<string, unknown> }).__HHR_E2E_OVERRIDE__ =
        records;
      localStorage.setItem('hhr_e2e_bootstrap_user', JSON.stringify(user));
      localStorage.setItem('firebase:authUser:test:[DEFAULT]', JSON.stringify({ uid: 'preview' }));
      localStorage.setItem('hhr_firebase_config', JSON.stringify(config));
      localStorage.setItem('hanga_roa_hospital_data', JSON.stringify(records));
    },
    { records, config, user: MOCK_USERS.admin }
  );
};

const trackRuntimeErrors = (page: Page): string[] => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error') errors.push(message.text());
  });
  return errors;
};

test('navigates from history to the current occupied or empty bed and copies a category-only code', async ({
  page,
  context,
}) => {
  const errors = trackRuntimeErrors(page);
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.setViewportSize({ width: 1280, height: 832 });
  await seedHistory(page);
  await page.goto(`/census?date=${DATE}`);
  await page.getByTestId('rayen-sync-history-button').click();
  await expect(page.getByRole('link', { name: 'Ver cama H5C2 · 27-09-2026' })).toHaveAttribute(
    'href',
    `/census?date=${DATE}&focusBed=H5C2`
  );
  await page.getByRole('button', { name: `Copiar código ${CODE}` }).click();
  await expect(page.getByText('Código copiado')).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(CODE);
  await page.screenshot({
    path: test.info().outputPath('sync-history-actions.png'),
    animations: 'disabled',
  });

  await page.getByRole('link', { name: 'Ver cama H5C2 · 27-09-2026' }).focus();
  await page.keyboard.press('Enter');
  const occupied = page.locator('tbody tr[data-bed-id="H5C2"]');
  await expect(occupied).toContainText('PACIENTE SINTÉTICO ACTUAL');
  await expect(occupied).toBeFocused();
  await expect(page).toHaveURL(new RegExp(`/census\\?date=${DATE}$`));
  expect(await occupied.evaluate(element => getComputedStyle(element).outlineStyle)).toBe('solid');
  expect(await occupied.evaluate(element => getComputedStyle(element).backgroundColor)).not.toBe(
    'rgb(240, 253, 250)'
  );
  const bounds = await occupied.boundingBox();
  expect(bounds!.y).toBeGreaterThanOrEqual(0);
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(832);
  await page.screenshot({
    path: test.info().outputPath('sync-bed-focus.png'),
    animations: 'disabled',
  });

  await page.getByTestId('rayen-sync-history-button').click();
  await page.getByRole('link', { name: 'Ver cama R4 · 27-09-2026' }).click();
  await expect(page.locator('tbody tr[data-bed-id="R4"]')).toBeFocused();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('opens the previous census for historical CUDYR without assuming the current bed', async ({
  page,
}) => {
  const errors = trackRuntimeErrors(page);
  await page.setViewportSize({ width: 1024, height: 666 });
  await seedHistory(page);
  await page.goto(`/census?date=${DATE}`);
  await page.getByTestId('rayen-sync-history-button').click();
  const historicalLink = page.getByRole('link', { name: 'Ver censo · 26-09-2026' });
  await expect(historicalLink).toHaveAttribute('href', `/census?date=${PRIOR_DATE}`);
  await page.screenshot({
    path: test.info().outputPath('sync-history-compact.png'),
    animations: 'disabled',
  });
  await historicalLink.click();
  await expect(page.locator('tbody tr[data-bed-id="R2"]')).toContainText(
    'PACIENTE SINTÉTICO PREVIO'
  );
  await expect(page).toHaveURL(new RegExp(`/census\\?date=${PRIOR_DATE}$`));
  await expect(page.locator('tbody tr[data-bed-id="H5C2"]')).not.toBeFocused();
  expect(errors).toEqual([]);
});
