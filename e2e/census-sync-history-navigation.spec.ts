import { expect, test, type Page } from '@playwright/test';
import { buildCanonicalE2ERecord, MOCK_USERS } from './fixtures/auth';
import { installPreviewFirebaseRuntime } from './fixtures/previewFirebase';

// Keep synthetic network fixtures independent of previously registered PWA workers.
test.use({ serviceWorkers: 'block' });

const DATE = '2026-09-27';
const PRIOR_DATE = '2026-09-26';
const CODE = 'HHR-SYNC-1/vitals/source_timeout';
const BACKGROUND_FIREBASE_REQUEST =
  /^https:\/\/(?:firestore\.googleapis\.com\/|www\.google\.com\/images\/cleardot\.gif(?:\?|$))/;

type RuntimeEvidence = { errors: string[]; blockedRequestUrls: Set<string> };

const isFixtureBackgroundRequest = (
  request: import('@playwright/test').Request,
  project: string
) => {
  const url = new URL(request.url());
  if (url.hostname === 'www.google.com')
    return request.method() === 'GET' && url.pathname === '/images/cleardot.gif';
  if (request.method() !== 'POST') return false;
  const database = `projects/${project}/databases/(default)`;
  const bodies = [...new URLSearchParams(request.postData() || '')]
    .filter(([key]) => /^req\d+___data__$/.test(key))
    .map(([, value]) => JSON.parse(value));
  if (!bodies.length) return false;
  return bodies.every(body => {
    if (body.database !== database) return false;
    if (url.pathname === '/google.firestore.v1.Firestore/Write/channel')
      return Object.keys(body).length === 1; // Initial SDK handshake, never a write payload.
    if (url.pathname !== '/google.firestore.v1.Firestore/Listen/channel') return false;
    if (Object.keys(body).some(key => !['database', 'addTarget'].includes(key))) return false;
    const target = body.addTarget;
    const documents = target?.documents?.documents;
    if (documents)
      return (
        documents.length === 1 &&
        [
          `${database}/documents/emailRecipientLists/census-default`,
          `${database}/documents/hospitals/hanga_roa/settings/rayenImportPolicy`,
        ].includes(documents[0])
      );
    const query = target?.query;
    return (
      query?.parent === `${database}/documents` &&
      query.structuredQuery?.from?.length === 1 &&
      query.structuredQuery.from[0].collectionId === 'emailRecipientLists'
    );
  });
};

const seedHistory = async (page: Page, runtime: RuntimeEvidence) => {
  const config = await installPreviewFirebaseRuntime(page);
  // Only known nonclinical bootstrap traffic may be unavailable in this local fixture.
  await page.route(BACKGROUND_FIREBASE_REQUEST, route => {
    const request = route.request();
    let expected = false;
    try {
      expected = isFixtureBackgroundRequest(request, config.projectId);
    } catch {
      /* malformed payload is unexpected */
    }
    if (expected) runtime.blockedRequestUrls.add(request.url());
    else
      runtime.errors.push(
        `Unexpected remote request: ${request.method()} ${new URL(request.url()).pathname}`
      );
    return route.abort('internetdisconnected');
  });
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
          {
            bedId: 'H5C2',
            source: 'vitals',
            reason: 'source_timeout',
            diagnostic: {
              patientName: 'PACIENTE SINTÉTICO ACTUAL',
              document: '12345678-5',
              clinicalEpisodeId: 'synthetic-navigation-episode',
              censusDate: DATE,
              bedId: 'H5C2',
            },
          },
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
      localStorage.setItem('hhr_e2e_force_local_only_sync', 'true');
      localStorage.setItem('firebase:authUser:test:[DEFAULT]', JSON.stringify({ uid: 'preview' }));
      localStorage.setItem('hhr_firebase_config', JSON.stringify(config));
      localStorage.setItem('hanga_roa_hospital_data', JSON.stringify(records));
    },
    { records, config, user: MOCK_USERS.admin }
  );
};

const trackRuntimeErrors = (page: Page): RuntimeEvidence => {
  const errors: string[] = [];
  const blockedRequestUrls = new Set<string>();
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.type() !== 'error') return;
    const blockedFixtureRequest =
      message.text() === 'Failed to load resource: net::ERR_INTERNET_DISCONNECTED' &&
      blockedRequestUrls.has(message.location().url);
    if (!blockedFixtureRequest) errors.push(message.text());
  });
  return { errors, blockedRequestUrls };
};

test('navigates from history to the current occupied or empty bed and copies a category-only code', async ({
  page,
  context,
}) => {
  const runtime = trackRuntimeErrors(page);
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.setViewportSize({ width: 1280, height: 832 });
  await seedHistory(page, runtime);
  await page.goto(`/census?date=${DATE}`);
  await page.getByTestId('rayen-sync-history-button').click();
  const notice = page.getByText('Qué quedó pendiente en la información clínica', { exact: true });
  await expect(notice.locator('..')).not.toHaveAttribute('open');
  await notice.click();
  await expect(page.getByRole('link', { name: 'Ver cama H5C2 · 27-09-2026' })).toHaveAttribute(
    'href',
    `/census?date=${DATE}&focusBed=H5C2`
  );
  await page.getByRole('button', { name: 'Copiar informe de sincronización' }).click();
  await expect(page.getByText('Resumen copiado')).toBeVisible();
  const report = JSON.parse(await page.evaluate(() => navigator.clipboard.readText()));
  expect(report.format).toBe('hhr.sync-diagnostic-report.v1');
  expect(report.attempts[0].issues[0]).toMatchObject({
    code: CODE,
    patientName: 'PACIENTE SINTÉTICO ACTUAL',
    document: '12345678-5',
    bedId: 'H5C2',
    censusDate: DATE,
    clinicalEpisodeId: 'synthetic-navigation-episode',
  });
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
  await page.getByText('Qué quedó pendiente en la información clínica', { exact: true }).click();
  await page.getByRole('link', { name: 'Ver cama R4 · 27-09-2026' }).click();
  await expect(page.locator('tbody tr[data-bed-id="R4"]')).toBeFocused();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(runtime.errors).toEqual([]);
});

test('opens the previous census for historical CUDYR without assuming the current bed', async ({
  page,
}) => {
  const runtime = trackRuntimeErrors(page);
  await page.setViewportSize({ width: 1024, height: 666 });
  await seedHistory(page, runtime);
  await page.goto(`/census?date=${DATE}`);
  await page.getByTestId('rayen-sync-history-button').click();
  await page.getByText('Qué quedó pendiente en la información clínica', { exact: true }).click();
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
  expect(runtime.errors).toEqual([]);
});
