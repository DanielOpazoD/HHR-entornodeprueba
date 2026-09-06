import { test, expect, type Page } from '@playwright/test';
import { buildCanonicalE2ERecord, MOCK_USERS } from './fixtures/auth';
import {
  installPreviewFirebaseRuntime,
  type FirebasePreviewConfig,
} from './fixtures/previewFirebase';

type PreviewRuntimeFailure = {
  source: 'console' | 'pageerror';
  message: string;
};

const isFatalPreviewConsoleError = (message: string): boolean =>
  /(uncaught|referenceerror|typeerror|syntaxerror|chunkloaderror|failed to fetch dynamically imported module|cannot access '.+' before initialization|createcontext|internal assertion failed|internal unhandled error)/i.test(
    message
  );

const PREVIEW_BOOTSTRAP_DATE = process.env.E2E_FIXED_DATE ?? '2026-04-03';
const SEEDED_PATIENT_NAME = 'PACIENTE VALIDACION PREVIEW';

const seedPersistedSessionAndRecord = async (page: Page) => {
  const firebaseConfig = await installPreviewFirebaseRuntime(page);
  const baseRecord = buildCanonicalE2ERecord(PREVIEW_BOOTSTRAP_DATE) as Record<string, unknown>;
  const baseBeds = baseRecord.beds as Record<string, Record<string, unknown>>;
  const seededRecord = buildCanonicalE2ERecord(PREVIEW_BOOTSTRAP_DATE, {
    beds: {
      ...baseBeds,
      R1: {
        ...baseBeds.R1,
        patientName: SEEDED_PATIENT_NAME,
        pathology: 'DIAGNOSTICO PREVIEW',
        age: '44',
        status: 'ESTABLE',
      },
    },
  });

  await page.addInitScript(
    ({
      bootstrapUser,
      date,
      record,
      runtimeConfig,
    }: {
      bootstrapUser: unknown;
      date: string;
      record: unknown;
      runtimeConfig: FirebasePreviewConfig;
    }) => {
      const runtimeWindow = window as Window & { __HHR_E2E_OVERRIDE__?: Record<string, unknown> };
      runtimeWindow.__HHR_E2E_OVERRIDE__ = {
        ...(runtimeWindow.__HHR_E2E_OVERRIDE__ || {}),
        [date]: record,
      };

      localStorage.setItem('hhr_e2e_bootstrap_user', JSON.stringify(bootstrapUser));
      localStorage.setItem('firebase:authUser:test:[DEFAULT]', JSON.stringify({ uid: 'preview' }));
      localStorage.setItem('hhr_firebase_config', JSON.stringify(runtimeConfig));

      const existing = JSON.parse(localStorage.getItem('hanga_roa_hospital_data') || '{}');
      existing[date] = record;
      localStorage.setItem('hanga_roa_hospital_data', JSON.stringify(existing));
    },
    {
      bootstrapUser: MOCK_USERS.admin,
      date: PREVIEW_BOOTSTRAP_DATE,
      record: seededRecord,
      runtimeConfig: firebaseConfig,
    }
  );
};

const collectPreviewDiagnostics = async (page: Page, date: string) =>
  page.evaluate((targetDate: string) => {
    const runtimeWindow = window as Window & { __HHR_E2E_OVERRIDE__?: Record<string, unknown> };
    const persistedRecords = JSON.parse(localStorage.getItem('hanga_roa_hospital_data') || '{}');
    const telemetry = JSON.parse(localStorage.getItem('operationalTelemetryEvents') || '[]');
    const rootElement = document.getElementById('root');

    return {
      href: window.location.href,
      overrideDates: Object.keys(runtimeWindow.__HHR_E2E_OVERRIDE__ || {}),
      overrideRecord: runtimeWindow.__HHR_E2E_OVERRIDE__?.[targetDate] || null,
      persistedRecordDates: Object.keys(persistedRecords),
      persistedRecord: persistedRecords[targetDate] || null,
      hasBootstrapUser: Boolean(localStorage.getItem('hhr_e2e_bootstrap_user')),
      hasFirebaseHint: Boolean(localStorage.getItem('firebase:authUser:test:[DEFAULT]')),
      telemetry: telemetry
        .filter(
          (event: { category?: string }) =>
            event?.category === 'daily_record' ||
            event?.category === 'indexeddb' ||
            event?.category === 'auth'
        )
        .slice(-20),
      rootChildCount: rootElement?.childElementCount || 0,
      rootHtmlLength: rootElement?.innerHTML.length || 0,
      pageTextSnippet: document.body.innerText.slice(0, 800),
    };
  }, date);

const createPreviewRuntimeFailureCollector = (page: Page) => {
  const failures: PreviewRuntimeFailure[] = [];

  const consoleHandler = (msg: { type(): string; text(): string }) => {
    if (msg.type() !== 'error') {
      return;
    }

    const message = msg.text();
    if (!isFatalPreviewConsoleError(message)) {
      return;
    }

    failures.push({
      source: 'console',
      message,
    });
  };

  const pageErrorHandler = (error: Error) => {
    failures.push({
      source: 'pageerror',
      message: error.message,
    });
  };

  page.on('console', consoleHandler);
  page.on('pageerror', pageErrorHandler);

  return {
    failures,
    detach: () => {
      page.off('console', consoleHandler);
      page.off('pageerror', pageErrorHandler);
    },
  };
};

const expectSeededPatientVisible = async (page: Page) => {
  const seededPatientInput = page.locator(
    '[data-testid="patient-row"][data-bed-id="R1"] input[name="patientName"]'
  );

  try {
    // The production bundle may need several seconds to hydrate IndexedDB/localStorage on a cold
    // preview worker. Keep the assertion strict, but give bootstrap enough time to finish under CI.
    await expect(seededPatientInput).toHaveValue(SEEDED_PATIENT_NAME, { timeout: 20_000 });
  } catch (error) {
    const diagnostics = await collectPreviewDiagnostics(page, PREVIEW_BOOTSTRAP_DATE);
    test.info().attach('preview-bootstrap-diagnostics', {
      body: JSON.stringify(diagnostics, null, 2),
      contentType: 'application/json',
    });
    throw new Error(
      `Seeded preview patient was not visible.\nDiagnostics:\n${JSON.stringify(diagnostics, null, 2)}`,
      { cause: error }
    );
  }
};

const assertPreviewBootCompleted = async (page: Page, runtimeFailures: PreviewRuntimeFailure[]) => {
  await expect(page.getByTestId('view-loader')).toBeHidden({ timeout: 5000 });
  await page.waitForFunction(() => {
    const rootElement = document.getElementById('root');
    return Boolean(rootElement && rootElement.childElementCount > 0);
  });
  const diagnostics = await collectPreviewDiagnostics(page, PREVIEW_BOOTSTRAP_DATE);

  if (runtimeFailures.length > 0) {
    test.info().attach('preview-runtime-failures', {
      body: JSON.stringify(runtimeFailures, null, 2),
      contentType: 'application/json',
    });
    test.info().attach('preview-bootstrap-diagnostics', {
      body: JSON.stringify(diagnostics, null, 2),
      contentType: 'application/json',
    });
    throw new Error(
      `Preview bootstrap produced runtime failures:\n${JSON.stringify(runtimeFailures, null, 2)}`
    );
  }

  expect(diagnostics.rootChildCount).toBeGreaterThan(0);
  expect(diagnostics.rootHtmlLength).toBeGreaterThan(0);
};

test.describe('Production Preview Bootstrap', () => {
  test.describe.configure({ timeout: 60_000 });

  test('loads persisted census state without falling into empty state after initial bootstrap', async ({
    page,
  }) => {
    const runtimeCollector = createPreviewRuntimeFailureCollector(page);
    await seedPersistedSessionAndRecord(page);

    await page.goto(`/?date=${PREVIEW_BOOTSTRAP_DATE}`);

    await expectSeededPatientVisible(page);
    await assertPreviewBootCompleted(page, runtimeCollector.failures);
    await expect(page.getByTestId('empty-day-prompt')).toHaveCount(0);
    runtimeCollector.detach();
  });

  test('keeps the census record visible across a second visit with persisted client state', async ({
    page,
  }) => {
    const runtimeCollector = createPreviewRuntimeFailureCollector(page);
    await seedPersistedSessionAndRecord(page);

    await page.goto(`/?date=${PREVIEW_BOOTSTRAP_DATE}`);
    await expectSeededPatientVisible(page);
    await assertPreviewBootCompleted(page, runtimeCollector.failures);

    await page.goto(`/?date=${PREVIEW_BOOTSTRAP_DATE}`);

    await expectSeededPatientVisible(page);
    await assertPreviewBootCompleted(page, runtimeCollector.failures);
    await expect(page.getByTestId('empty-day-prompt')).toHaveCount(0);
    runtimeCollector.detach();
  });

  test('does not surface runtime bootstrap errors before the preview app mounts', async ({
    page,
  }) => {
    const runtimeCollector = createPreviewRuntimeFailureCollector(page);
    await seedPersistedSessionAndRecord(page);

    await page.goto(`/?date=${PREVIEW_BOOTSTRAP_DATE}`);

    await expectSeededPatientVisible(page);
    await assertPreviewBootCompleted(page, runtimeCollector.failures);
    runtimeCollector.detach();
  });

  test('keeps Firestore listeners healthy through repeated persisted reloads', async ({ page }) => {
    const runtimeCollector = createPreviewRuntimeFailureCollector(page);
    await seedPersistedSessionAndRecord(page);
    await page.goto(`/?date=${PREVIEW_BOOTSTRAP_DATE}`);

    // Same browser context and IndexedDB across reloads: exercise target teardown/recreation
    // without clearing persistence or suppressing the SDK errors (firebase-js-sdk#9842).
    for (let visit = 0; visit < 4; visit += 1) {
      await expectSeededPatientVisible(page);
      await assertPreviewBootCompleted(page, runtimeCollector.failures);
      await expect(page.getByTestId('empty-day-prompt')).toHaveCount(0);
      if (visit < 3) await page.reload();
    }
    runtimeCollector.detach();
  });
});
