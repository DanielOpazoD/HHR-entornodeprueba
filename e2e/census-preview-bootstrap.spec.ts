import moaCatalogFixture from '../src/tests/fixtures/moa/catalog.json' with { type: 'json' };
import sharp from 'sharp';
import { createHash } from 'node:crypto';
import { checkCensusToolbarRefresh } from './fixtures/censusToolbarRefresh';
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

const buildViewportDischarges = () =>
  Array.from({ length: 12 }, (_, index) => ({
    id: `preview-discharge-${index + 1}`,
    movementDate: PREVIEW_BOOTSTRAP_DATE,
    admissionDate: PREVIEW_BOOTSTRAP_DATE,
    bedName: `R${index + 1}`,
    bedId: `R${index + 1}`,
    bedType: 'Adulto',
    patientName: `ALTA SINTETICA ${index + 1}`,
    rut: '',
    diagnosis: 'DIAGNOSTICO SINTETICO',
    time: '12:00',
    status: 'Vivo',
    dischargeType: 'Domicilio (Habitual)',
  }));

const seedPersistedSessionAndRecord = async (
  page: Page,
  recordOverrides: Record<string, unknown> = {}
) => {
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
    ...recordOverrides,
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
  test.beforeEach(async ({ page }) => {
    // Existing regression tests exercise the bundled fallback, independent of network/content releases.
    await page.route('**/moa-library/**', route => route.fulfill({ status: 503, body: 'offline' }));
  });

  test('aligns newborn identity with normal beds and preserves the new chrome on reload', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1672, height: 941 });
    const base = buildCanonicalE2ERecord(PREVIEW_BOOTSTRAP_DATE);
    const beds = base.beds as Record<string, Record<string, unknown>>;
    const newborn = {
      ...beds.R1,
      bedId: 'R1',
      patientName: 'Rn DE PACIENTE VALIDACION',
      firstName: '',
      lastName: '',
      secondLastName: '',
      age: '1d',
      rut: '',
      identityStatus: 'provisional',
      clinicalEpisodeId: 'synthetic-newborn-episode',
      admissionDate: PREVIEW_BOOTSTRAP_DATE,
      specialty: 'Pediatría',
      bedMode: 'Cuna',
    };
    await seedPersistedSessionAndRecord(page, {
      beds: {
        ...beds,
        R1: {
          ...beds.R1,
          patientName: SEEDED_PATIENT_NAME,
          firstName: '',
          lastName: '',
          secondLastName: '',
          age: '28',
          clinicalEpisodeId: 'synthetic-mother-episode',
          admissionDate: PREVIEW_BOOTSTRAP_DATE,
          specialty: 'Ginecobstetricia',
          clinicalCrib: newborn,
        },
        R2: {
          ...beds.R2,
          patientName:
            'Paciente normal con un nombre largo y dos apellidos para comprobar su alineación',
          age: '68',
          clinicalEpisodeId: 'synthetic-wrapped-mother',
          clinicalCrib: {
            ...newborn,
            bedId: 'R2',
            patientName: 'rn de Madre',
            clinicalEpisodeId: 'synthetic-second-newborn',
          },
        },
      },
    });
    let releaseApp!: () => void;
    const appReady = new Promise<void>(resolve => {
      releaseApp = resolve;
    });
    await page.route(/\/assets\/index-[^/]+\.js$/, async route => {
      await appReady;
      await route.continue();
    });
    try {
      await page.goto(`/census?date=${PREVIEW_BOOTSTRAP_DATE}`, { waitUntil: 'commit' });
      await expect(page.locator('html')).toHaveAttribute('data-preboot-surface', 'app');
      const background = await page.locator('html').evaluate(element => {
        const style = getComputedStyle(element);
        return { image: style.backgroundImage, size: style.backgroundSize };
      });
      expect(background.image).not.toContain('url(');
      expect(background.image).toContain('linear-gradient(112deg');
      expect(background.image).toContain('rgb(23, 62, 92)');
      expect(background.size).toContain('52px');
      expect(background.size).toContain('56px');
      // Capture the actual preboot paint while the app chunk is held. Playwright's
      // screenshot waits for document.fonts.ready, which depends on releasing it.
      const cdp = await page.context().newCDPSession(page);
      const preboot = await cdp.send('Page.captureScreenshot', { format: 'png' });
      await cdp.detach();
      await test.info().attach('new-navbar-preboot', {
        body: Buffer.from(preboot.data, 'base64'),
        contentType: 'image/png',
      });
    } finally {
      releaseApp();
    }
    await expectSeededPatientVisible(page);
    await page.evaluate(() => document.fonts.ready);
    const parent = page.locator('[data-bed-id="R1"][data-testid="patient-row"]');
    const crib = page.locator('tr[data-testid="patient-row"]').filter({ hasText: 'C-R1' });
    await expect(crib.getByTestId('clinical-panel-trigger-R1-clinical-crib')).toBeVisible();
    await expect(crib.locator('input[name="patientName"]')).toHaveValue(
      'RN DE PACIENTE VALIDACION'
    );
    await expect(crib.locator('.lucide-arrow-right')).toHaveCount(0);
    await expect(crib.locator('[data-testid^="patient-laboratory-trigger"]')).toHaveCount(0);
    await expect(crib.locator('[data-testid^="patient-radiology-trigger"]')).toHaveCount(0);
    const geometry = async (row: ReturnType<Page['locator']>) =>
      row.evaluate(element => {
        const cell = element.querySelector('.census-identity-cell')!;
        const name = cell.querySelector('.census-identity-name')!;
        const age = cell.querySelector(
          '[aria-label="Edad del paciente, abre datos demográficos"]'
        )!;
        const clinical = cell.querySelector('[data-testid^="clinical-panel-trigger"]')!;
        const origin = element.getBoundingClientRect();
        const relative = (node: Element) => {
          const box = node.getBoundingClientRect();
          return { x: box.x - origin.x, y: box.y - origin.y };
        };
        return { name: relative(name), age: relative(age), clinical: relative(clinical) };
      });
    const motherGeometry = await geometry(parent);
    const newbornGeometry = await geometry(crib);
    for (const part of ['name', 'age', 'clinical'] as const) {
      expect(Math.abs(newbornGeometry[part].y - motherGeometry[part].y), part).toBeLessThanOrEqual(
        1
      );
    }
    expect(newbornGeometry.age.x).toBeLessThan(newbornGeometry.clinical.x);
    expect(Math.abs(newbornGeometry.clinical.x - motherGeometry.clinical.x)).toBeLessThanOrEqual(1);
    const wrappedParent = page.locator('[data-bed-id="R2"][data-testid="patient-row"]');
    const secondCrib = page.locator('tr[data-testid="patient-row"]').filter({ hasText: 'C-R2' });
    expect(
      (await wrappedParent.locator('.census-identity-name').boundingBox())!.height
    ).toBeGreaterThan(28);
    const wrappedGeometry = await geometry(wrappedParent);
    const secondCribGeometry = await geometry(secondCrib);
    expect(
      Math.abs(wrappedGeometry.clinical.y - secondCribGeometry.clinical.y)
    ).toBeLessThanOrEqual(1);
    expect(
      Math.abs(wrappedGeometry.clinical.x - secondCribGeometry.clinical.x)
    ).toBeLessThanOrEqual(1);
    await expect(secondCrib.locator('input[name="patientName"]')).toHaveValue('RN de Madre');
    const nav = page.getByRole('navigation', { name: 'Navegación principal HHR' });
    await expect(nav).toHaveCSS('background-color', 'rgb(32, 87, 119)');
    await expect(nav).toHaveCSS('background-image', /linear-gradient/);
    await expect(nav.locator('.hhr-navbar-landscape')).toHaveCount(0);
    await test.info().attach('new-navbar-and-newborn', {
      body: await page.screenshot(),
      contentType: 'image/png',
    });
    await page.reload();
    await expectSeededPatientVisible(page);
    await expect(nav).toHaveCSS('background-color', 'rgb(32, 87, 119)');
    await expect(nav).toHaveCSS('background-image', /linear-gradient/);
    await expect(crib.getByTestId('clinical-panel-trigger-R1-clinical-crib')).toBeVisible();
    await test.info().attach('new-navbar-after-reload', {
      body: await page.screenshot(),
      contentType: 'image/png',
    });
  });

  for (const width of [768, 1440]) {
    test(`preserves toolbar controls and geometry during refresh at ${width}px`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      await seedPersistedSessionAndRecord(page);
      await page.addInitScript(() => {
        localStorage.setItem(
          'hhr_feature_flags',
          JSON.stringify({ SPECIALTY_JEV_CONSULTATION: true })
        );
      });
      await checkCensusToolbarRefresh(page, PREVIEW_BOOTSTRAP_DATE);
    });
  }

  test('keeps quiet fields, hover admission, floating menus and the header usable', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 800 });
    const runtimeCollector = createPreviewRuntimeFailureCollector(page);
    await seedPersistedSessionAndRecord(page, {
      discharges: buildViewportDischarges(),
      nursesDayShift: ['Ana María Soto Rojas', ''],
      tensDayShift: ['Carolina Valenzuela Riquelme', '', ''],
    });
    // The pilot is enabled on the developer's machine, but not in standard CI builds.
    // Seed the UI feature explicitly; this test never consults Jev or writes clinical data.
    await page.addInitScript(() => {
      localStorage.setItem(
        'hhr_feature_flags',
        JSON.stringify({ SPECIALTY_JEV_CONSULTATION: true })
      );
    });
    await page.goto(`/?date=${PREVIEW_BOOTSTRAP_DATE}`);
    await expectSeededPatientVisible(page);
    await assertPreviewBootCompleted(page, runtimeCollector.failures);

    const nurse = page.getByRole('combobox', { name: 'Enfermería · turno largo · puesto 1' });
    await nurse.focus();
    await expect(
      page.getByRole('tooltip').filter({ hasText: 'Ana María Soto Rojas' })
    ).toBeVisible();
    const tens = page.getByRole('combobox', { name: 'TENS · turno largo · puesto 1' });
    await tens.focus();
    await expect(
      page.getByRole('tooltip').filter({ hasText: 'Carolina Valenzuela Riquelme' })
    ).toBeVisible();

    const name = page.locator('.census-identity-name').first();
    const diagnosis = page.getByRole('button', { name: 'Editar diagnóstico', exact: true }).first();
    await expect(name).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    await expect(diagnosis).toHaveCSS('border-top-color', 'rgba(0, 0, 0, 0)');
    await diagnosis.focus();
    await expect(diagnosis).not.toHaveCSS('box-shadow', 'none');

    const admission = page.getByRole('button', { name: 'Agregar paciente', exact: true }).first();
    await expect(admission).toHaveCSS('opacity', '0');
    await admission.focus();
    await expect(admission).toHaveCSS('opacity', '1');
    await page.mouse.move(1, 1);
    await admission.blur();
    await expect(admission).toHaveCSS('opacity', '0');

    await page
      .locator('[data-testid="patient-row"][data-bed-id="R1"]')
      .getByTitle('Asignar especialidad', { exact: true })
      .click();
    const specialty = page.getByTestId('specialty-actions').locator('summary');
    await specialty.click();
    const rules = page.getByRole('button', { name: 'Reglas automáticas', exact: true });
    await expect(rules).toBeInViewport({ ratio: 1 });
    const hitTest = await rules.evaluate(element => {
      const rect = element.getBoundingClientRect();
      return element.contains(
        document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)
      );
    });
    expect(hitTest).toBe(true);
    await specialty.click();
    await page.getByRole('button', { name: 'Cerrar selector de especialidad' }).click();

    await page.evaluate(() => window.scrollTo(0, 360));
    const header = page.getByTestId('census-table').locator('thead');
    const chromeHeight = await page
      .locator('.hhr-date-strip')
      .evaluate(element => element.getBoundingClientRect().bottom);
    await expect.poll(async () => (await header.boundingBox())?.y).toBeCloseTo(chromeHeight, 0);
    await expect(header).toBeInViewport({ ratio: 1 });
    await assertPreviewBootCompleted(page, runtimeCollector.failures);
    runtimeCollector.detach();
  });

  for (const width of [375, 768, 1440]) {
    test(`keeps navigation above usable census actions at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      const runtimeCollector = createPreviewRuntimeFailureCollector(page);
      await seedPersistedSessionAndRecord(page);
      await page.goto(`/?date=${PREVIEW_BOOTSTRAP_DATE}`);
      await expectSeededPatientVisible(page);

      const topBar = page.getByRole('navigation');
      await expect(topBar).toBeVisible();
      const geometry = await topBar.evaluate(element => ({
        height: element.getBoundingClientRect().height,
        bottom: element.getBoundingClientRect().bottom,
        scrollHeight: element.scrollHeight,
      }));
      const expectedHeight = width < 640 ? 48 : 52;
      expect(geometry.height).toBe(expectedHeight);
      expect(geometry.scrollHeight).toBeLessThanOrEqual(expectedHeight);
      for (const name of ['Censo Diario', 'Entrega Turno Enfermería']) {
        const tab = topBar.getByRole('button', { name, exact: true });
        if (width === 768) {
          // A full-label tab can exceed its scrollport on Linux. Assert that
          // scrolling exposes a usable button, not platform-specific padding.
          await tab.scrollIntoViewIfNeeded();
          await tab.click({ trial: true });
        } else {
          // Phone icons and desktop labels must fit without scrolling.
          await expect(tab).toBeInViewport({ ratio: 1 });
        }
        const bounds = await tab.boundingBox();
        expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(geometry.bottom);
      }

      // Full hit targets and panels must remain usable, not just their icons.
      const utility = topBar.getByRole('button', { name: 'Abrir módulos utilitarios' });
      await expect(utility).toBeInViewport({ ratio: 1 });
      await utility.click();
      const utilityPanel = page.getByRole('group', { name: 'Módulos adicionales' });
      await expect(utilityPanel).toBeInViewport({ ratio: 1 });
      await utilityPanel.getByRole('button', { name: 'Estadísticas' }).focus();
      await page.keyboard.press('Escape');
      await expect(utilityPanel).toBeHidden();
      await expect(utility).toBeFocused();

      if (width >= 768) {
        const save = page.getByTitle('Opciones de guardado');
        await save.click();
        await page.getByRole('button', { name: /Descargar Excel/ }).click({ trial: true });
        await save.click();
        const email = page.getByTitle('Enviar censo');
        await email.click();
        // The synthetic session has no configured recipients. Validate the menu
        // placement without enabling or sending a real census email.
        const sendItem = page.getByRole('button', { name: /Enviar Archivo Excel/ });
        await expect(sendItem).toBeInViewport({ ratio: 1 });
        expect(
          await sendItem.evaluate(element => {
            const rect = element.getBoundingClientRect();
            return element.contains(
              document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)
            );
          })
        ).toBe(true);
        await email.click();
        const year = page.getByRole('button', { name: '2026', exact: true });
        await year.click();
        await page.getByRole('button', { name: '2025', exact: true }).click({ trial: true });
        await year.first().click();
      }

      const moaToggle = topBar.locator('[data-moa-toggle]');
      await expect(moaToggle).toBeInViewport({ ratio: 1 });
      await utility.click();
      await moaToggle.click();
      await expect(utilityPanel).toBeHidden();
      await expect(page.getByRole('region', { name: 'Moa', exact: true })).toBeVisible();
      await expect(moaToggle).toBeFocused();
      await page.keyboard.press('Enter');
      await expect(page.getByRole('region', { name: 'Moa', exact: true })).toBeHidden();
      await page.keyboard.press('Enter');
      await expect(page.getByRole('region', { name: 'Moa', exact: true })).toBeVisible();
      await expect(page.getByRole('region', { name: 'Moa · Ayuda de HHR' })).toHaveCount(0);
      await expectSeededPatientVisible(page);

      const options = page.getByRole('button', { name: 'Más opciones del censo' });
      const bounds = await options.boundingBox();
      expect(bounds!.y).toBeGreaterThanOrEqual(geometry.bottom);
      await options.click();
      await expect(page.getByRole('group', { name: 'Opciones del censo' })).toBeVisible();
      await options.click();
      await test.info().attach(`navigation-${width}px`, {
        body: await page.screenshot(),
        contentType: 'image/png',
      });
      await page.getByTestId('clinical-library-quick-action').click();
      await expect(page.getByTestId('clinical-library-drawer')).toBeVisible();
      await assertPreviewBootCompleted(page, runtimeCollector.failures);
      runtimeCollector.detach();
    });
  }

  for (const width of [375, 768, 1440]) {
    test(`persists the census companion visibility at ${width}px`, async ({ page }) => {
      const runtimeCollector = createPreviewRuntimeFailureCollector(page);
      await page.setViewportSize({ width, height: 900 });
      await seedPersistedSessionAndRecord(page);
      await page.goto(`/?date=${PREVIEW_BOOTSTRAP_DATE}`);
      await expectSeededPatientVisible(page);
      const toggle = page.locator('[data-moa-toggle]');
      await expect(toggle).toHaveAttribute('aria-pressed', 'false');
      await expect(page.getByRole('region', { name: 'Moa', exact: true })).toHaveCount(0);
      await toggle.click();
      const companion = page.getByRole('region', { name: 'Moa', exact: true });
      await expect(companion.getByRole('button', { name: 'Jugar con Moa' })).toHaveAttribute(
        'data-gesture',
        'idle'
      );
      const mascot = companion.getByTestId('moa-mascot');
      await expect(mascot).toBeVisible();
      await expect
        .poll(() => mascot.evaluate((image: HTMLImageElement) => image.naturalWidth))
        .toBe(1728);
      const summary = await page.getByTestId('census-summary-switcher').boundingBox();
      const area = await companion.boundingBox();
      if (width >= 640) {
        expect(area!.x).toBeGreaterThanOrEqual(summary!.x + summary!.width + 6);
        expect(Math.abs(area!.y - summary!.y)).toBeLessThanOrEqual(1);
      } else {
        expect(area!.y).toBeGreaterThanOrEqual(summary!.y + summary!.height);
      }
      expect(area!.x + area!.width).toBeLessThanOrEqual(width);
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await test.info().attach(`moa-companion-${width}px`, {
        body: await page.screenshot(),
        contentType: 'image/png',
      });
      await toggle.click();
      await expect(companion).toBeHidden();
      await expect(toggle).toHaveAttribute('aria-pressed', 'false');
      await page.reload();
      await expectSeededPatientVisible(page);
      await expect(companion).toBeHidden();
      await toggle.click();
      await expect(companion).toBeVisible();
      await companion.getByRole('button', { name: 'Ocultar Moa', exact: true }).click();
      await expect(toggle).toBeFocused();
      await toggle.click();
      await page.reload();
      await expectSeededPatientVisible(page);
      await expect(companion).toBeVisible();
      await assertPreviewBootCompleted(page, runtimeCollector.failures);
      runtimeCollector.detach();
      await page.emulateMedia({ media: 'print' });
      await expect(companion).toBeHidden();
      await expect(toggle).toBeHidden();
    });
  }

  test('keeps the census and visibility control usable without the optional mascot image', async ({
    page,
  }) => {
    await page.route('**/images/moa/**', route => route.fulfill({ status: 404, body: '' }));
    await seedPersistedSessionAndRecord(page);
    await page.goto(`/?date=${PREVIEW_BOOTSTRAP_DATE}`);
    await expectSeededPatientVisible(page);
    await page.locator('[data-moa-toggle]').click();
    const companion = page.getByRole('region', { name: 'Moa', exact: true });
    await expect(companion.getByTestId('moa-mascot')).toHaveCount(0);
    await companion.getByRole('button', { name: 'Ocultar Moa' }).click();
    await expect(page.locator('[data-moa-toggle]')).toBeFocused();
    await expectSeededPatientVisible(page);
  });

  test('plays surprise scenes without selectors, rests quietly and respects reduced motion', async ({
    page,
  }) => {
    // This regression exercises the original offline fallback, not the independent live release.
    await page.route('**/moa-library/**', route => route.fulfill({ status: 503, body: '' }));
    await seedPersistedSessionAndRecord(page);
    await page.goto(`/?date=${PREVIEW_BOOTSTRAP_DATE}`);
    await expectSeededPatientVisible(page);
    await page.locator('[data-moa-toggle]').click();
    const companion = page.getByRole('region', { name: 'Moa', exact: true });
    const character = companion.getByRole('button', { name: 'Jugar con Moa' });
    const sprite = companion.getByTestId('moa-mascot');
    await expect(companion.getByRole('button', { name: /Pausar|Reanudar/ })).toHaveCount(0);
    await expect(character).toHaveAttribute('data-gesture', 'idle', { timeout: 6000 });
    await expect(sprite).toHaveCSS('animation-name', 'none');
    const scenes = [
      'drink',
      'juggle',
      'care',
      'sleep',
      'yawn',
      'pushups',
      'roll',
      'jump',
      'run',
      'wink',
      'love',
      'angry',
      'mother',
      'surf',
      'wave',
      'curious',
      'stroll',
      'happy',
    ];
    await character.evaluate(button => {
      button.addEventListener(
        'pointerdown',
        event => {
          button.dataset.pointerTarget = event.target === button ? 'button' : 'child';
        },
        { once: true }
      );
    });
    await expect(companion.getByRole('button')).toHaveCount(2);
    await expect(companion.getByRole('button', { name: 'Elegir animación de Moa' })).toHaveCount(0);
    await expect(companion.getByRole('listbox')).toHaveCount(0);
    let lastChoice = '';
    for (const scene of scenes) {
      const available = scenes.filter(id => id !== lastChoice);
      await page.evaluate(
        value => {
          Math.random = () => value;
        },
        (available.indexOf(scene) + 0.5) / available.length
      );
      lastChoice = scene;
      await character.click();
      await expect(character).toHaveAttribute('data-pointer-target', 'button');
      await expect(character).toHaveAttribute('data-gesture', scene);
      await expect(companion.locator(`[data-moa-scene="${scene}"]`)).toBeVisible();
      await expect(companion.locator('.moa-scene-frames')).toHaveAttribute('data-ready', 'true');
      await expect
        .poll(() =>
          companion
            .locator('.moa-scene-frames')
            .evaluate((image: HTMLImageElement) => image.naturalWidth)
        )
        .toBe(1728);
      // Let the browser install the new CSS animation before seeking its frame.
      await page.evaluate(
        () =>
          new Promise<void>(resolve => {
            requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
          })
      );
      // Freeze actual browser animations at a representative frame; no wall-clock sleep.
      await character.evaluate((element, name) => {
        for (const animation of element.getAnimations({ subtree: true })) {
          animation.pause();
          animation.currentTime = name === 'sleep' ? 4000 : 1500;
        }
      }, scene);
      await test.info().attach(`moa-${scene}`, {
        body: await companion.screenshot(),
        contentType: 'image/png',
      });
    }
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, value: true });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await expect(companion.locator('.moa-scene-frames')).toHaveCSS(
      'animation-play-state',
      'paused'
    );
    await page.evaluate(() => {
      Reflect.deleteProperty(document, 'hidden');
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await character.click();
    const activeFrames = companion.locator('.moa-scene-frames');
    await expect(activeFrames).toHaveCSS('animation-name', 'moa-still');
    const stillTransform = await activeFrames.evaluate(image => getComputedStyle(image).transform);
    await activeFrames.evaluate(image => {
      const clock = image.getAnimations()[0];
      clock.currentTime = 700;
    });
    await expect(activeFrames).toHaveCSS('transform', stillTransform);
    await expect(character).toHaveAttribute('data-gesture', 'idle', { timeout: 6000 });
    await expect(sprite).toHaveCSS('animation-name', 'none');
    await character.focus();
    await page.keyboard.press('Escape');
    await expect(companion).toBeHidden();
    await expect(page.locator('[data-moa-toggle]')).toBeFocused();
  });

  test('keeps Moa in the document on a short viewport and excludes it from print', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 340 });
    await seedPersistedSessionAndRecord(page);
    await page.goto(`/?date=${PREVIEW_BOOTSTRAP_DATE}`);
    await expectSeededPatientVisible(page);
    await page.locator('[data-moa-toggle]').click();
    const companion = page.getByRole('region', { name: 'Moa', exact: true });
    await companion.scrollIntoViewIfNeeded();
    await expect(companion).toBeInViewport({ ratio: 1 });
    await expect(page.getByRole('region', { name: 'Moa · Ayuda de HHR' })).toHaveCount(0);
    await companion.getByRole('button', { name: 'Jugar con Moa' }).focus();
    await page.keyboard.press('Escape');
    await expect(companion).toBeHidden();
    await expect(page.locator('[data-moa-toggle]')).toBeFocused();
    await page.locator('[data-moa-toggle]').click();
    await expect(companion).toBeVisible();
    await page.emulateMedia({ media: 'print' });
    await expect(companion).toBeHidden();
  });

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

  test('fits the census and compact toolbar in a 1280px viewport', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    const runtimeCollector = createPreviewRuntimeFailureCollector(page);
    await seedPersistedSessionAndRecord(page);
    await page.goto(`/?date=${PREVIEW_BOOTSTRAP_DATE}`);
    await expectSeededPatientVisible(page);
    await assertPreviewBootCompleted(page, runtimeCollector.failures);

    const layout = await page.evaluate(() => {
      const table = document.querySelector('[aria-label="Censo de pacientes, tabla desplazable"]');
      const toolbar = document.querySelector('[data-testid="census-staff-and-sync"]');
      if (!table || !toolbar) return null;
      const surfaces = Array.from(
        toolbar.querySelectorAll('.census-toolbar-card, [data-testid="rayen-operations-bar"]')
      ).map(element => element.getBoundingClientRect());
      return {
        tableWidth: table.clientWidth,
        tableScrollWidth: table.scrollWidth,
        toolbarHeight: toolbar.getBoundingClientRect().height,
        toolbarTopSpread:
          Math.max(...surfaces.map(rect => rect.top)) - Math.min(...surfaces.map(rect => rect.top)),
        toolbarHeightSpread:
          Math.max(...surfaces.map(rect => rect.height)) -
          Math.min(...surfaces.map(rect => rect.height)),
        pageWidth: document.documentElement.clientWidth,
        pageScrollWidth: document.documentElement.scrollWidth,
      };
    });

    expect(layout).not.toBeNull();
    if (layout) {
      expect(layout.tableScrollWidth).toBeLessThanOrEqual(layout.tableWidth);
      expect(layout.pageScrollWidth).toBeLessThanOrEqual(layout.pageWidth);
      expect(layout.toolbarHeight).toBeLessThanOrEqual(92);
      expect(layout.toolbarTopSpread).toBeLessThanOrEqual(1);
      expect(layout.toolbarHeightSpread).toBeLessThanOrEqual(1);
    }
    const statusHeader = page.getByRole('columnheader', { name: 'Estado clínico' });
    await expect(statusHeader).toBeEmpty();
    expect(await statusHeader.evaluate(element => element.clientWidth)).toBeLessThanOrEqual(40);
    const selectedDateLabel = new Intl.DateTimeFormat('es-CL', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      timeZone: 'UTC',
    }).format(new Date(`${PREVIEW_BOOTSTRAP_DATE}T12:00:00Z`));
    await expect(page.getByRole('button', { name: selectedDateLabel })).toBeVisible();
    await expect(page.getByTitle('Opciones de guardado')).toHaveClass(/bg-white/);
    await expect(page.getByTitle('Enviar censo')).toHaveClass(/bg-teal-600/);
    runtimeCollector.detach();
  });

  for (const width of [375, 768, 1440]) {
    test(`keeps the final movement menu inside the initial viewport at ${width}px`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 768 });
      const runtimeCollector = createPreviewRuntimeFailureCollector(page);
      await seedPersistedSessionAndRecord(page, { discharges: buildViewportDischarges() });

      await page.goto(`/?date=${PREVIEW_BOOTSTRAP_DATE}`);
      await expectSeededPatientVisible(page);
      await assertPreviewBootCompleted(page, runtimeCollector.failures);
      await page.evaluate(async () => {
        await document.fonts.ready;
        await new Promise<void>(resolve =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
        );
      });

      const trigger = page.getByTitle('Abrir menú de acciones').last();
      await trigger.scrollIntoViewIfNeeded();
      const before = await page.evaluate(() => ({
        scrollHeight: document.documentElement.scrollHeight,
        scrollY: window.scrollY,
      }));

      await trigger.click();
      const menu = page.getByRole('menu');
      await expect(menu).toBeVisible();
      await expect(menu).toBeInViewport({ ratio: 1 });
      const after = await menu.evaluate(element => ({
        top: element.getBoundingClientRect().top,
        bottom: element.getBoundingClientRect().bottom,
        viewportHeight: window.innerHeight,
        scrollHeight: document.documentElement.scrollHeight,
        scrollY: window.scrollY,
      }));

      expect(after.top).toBeGreaterThanOrEqual(8);
      expect(after.bottom).toBeLessThanOrEqual(after.viewportHeight - 8);
      expect(Math.abs(after.scrollHeight - before.scrollHeight)).toBeLessThanOrEqual(1);
      expect(after.scrollY).toBe(before.scrollY);
      await assertPreviewBootCompleted(page, runtimeCollector.failures);
      runtimeCollector.detach();
    });
  }
  test('keeps the census usable after an unavailable companion chunk and recovers by confirmed reload', async ({
    page,
  }) => {
    const companionChunk = /\/assets\/MoaCompanion-[^/]+\.js$/;
    await page.route(companionChunk, route => route.abort());
    await seedPersistedSessionAndRecord(page);
    await page.goto(`/?date=${PREVIEW_BOOTSTRAP_DATE}`);
    await expectSeededPatientVisible(page);
    await page.locator('[data-moa-toggle]').click();
    await expect(page.locator('#census-moa').getByRole('alert')).toHaveText(
      'No se pudo mostrar Moa.'
    );
    page.once('dialog', dialog => dialog.dismiss());
    await page.getByRole('button', { name: 'Recargar aplicación', exact: true }).click();
    await expectSeededPatientVisible(page);
    await page.getByRole('button', { name: 'Ocultar Moa', exact: true }).last().click();
    await expect(page.locator('[data-moa-toggle]')).toBeFocused();
    await page.locator('[data-moa-toggle]').click();
    await expect(page.locator('#census-moa').getByRole('alert')).toBeVisible();
    await page.unroute(companionChunk);
    page.once('dialog', dialog => dialog.accept());
    await Promise.all([
      page.waitForEvent('domcontentloaded'),
      page.getByRole('button', { name: 'Recargar aplicación', exact: true }).click(),
    ]);
    await expectSeededPatientVisible(page);
    await expect(page.getByRole('region', { name: 'Moa', exact: true })).toBeVisible();
  });
});

test('aligns equivalent discharge and transfer columns despite different content lengths', async ({
  page,
}, testInfo) => {
  await seedPersistedSessionAndRecord(page, {
    discharges: [
      {
        ...buildViewportDischarges()[0],
        patientName: 'ALTA SINTETICA CON NOMBRE LARGO PARA VALIDACION',
        diagnosis: 'Diagnóstico de prueba',
      },
    ],
    transfers: [
      {
        id: 'synthetic-aligned-transfer',
        bedId: 'R6',
        bedName: 'R6',
        bedType: 'Adulto',
        patientName: 'TRASLADO SINTETICO',
        rut: '',
        diagnosis:
          'Diagnóstico sintético de mucha mayor longitud para comprobar que el texto se ajusta sin desplazar las columnas equivalentes',
        evacuationMethod: 'Ambulancia',
        receivingCenter: 'Hospital de destino sintético con nombre largo',
        movementDate: PREVIEW_BOOTSTRAP_DATE,
        time: '12:00',
      },
    ],
  });
  await page.goto('/?date=' + PREVIEW_BOOTSTRAP_DATE);
  await expectSeededPatientVisible(page);
  const discharges = page.locator('.census-movement-section').filter({
    has: page.getByRole('heading', { name: 'Altas', exact: true }),
  });
  const transfers = page.locator('.census-movement-section').filter({
    has: page.getByRole('heading', { name: 'Traslados', exact: true }),
  });
  for (const width of [1440, 1024, 375]) {
    await page.setViewportSize({ width, height: 768 });
    await expect(transfers.getByRole('row').last()).toBeVisible();
    for (const column of [0, 1, 2, 5, 6]) {
      const a = await discharges.getByRole('columnheader').nth(column).boundingBox();
      const b = await transfers.getByRole('columnheader').nth(column).boundingBox();
      if (!a || !b) throw new Error('Missing equivalent movement column');
      expect(Math.abs(a.x - b.x)).toBeLessThanOrEqual(1);
      expect(Math.abs(a.width - b.width)).toBeLessThanOrEqual(1);
    }
    for (const section of [discharges, transfers]) {
      const menuButton = await section.getByTitle('Abrir menú de acciones').boundingBox();
      const epicrisisButton = await section
        .getByRole('button', { name: /epicrisis/i })
        .boundingBox();
      if (!menuButton || !epicrisisButton) throw new Error('Missing movement actions');
      expect(
        Math.abs(
          menuButton.y + menuButton.height / 2 - epicrisisButton.y - epicrisisButton.height / 2
        )
      ).toBeLessThanOrEqual(1);
      expect(
        await section
          .locator('th')
          .nth(1)
          .evaluate(el => getComputedStyle(el).paddingLeft)
      ).toBe(
        await section
          .locator('td')
          .nth(1)
          .evaluate(el => getComputedStyle(el).paddingLeft)
      );
      await testInfo.attach('movement-' + width + '-' + (await section.locator('h2').innerText()), {
        body: await section.screenshot(),
        contentType: 'image/png',
      });
    }
  }
  const scroll = transfers.getByRole('region', { name: 'Traslados', exact: true });
  await scroll.focus();
  await page.keyboard.press('ArrowRight');
  await expect.poll(() => scroll.evaluate(el => el.scrollLeft)).toBeGreaterThan(0);
  await page.emulateMedia({ media: 'print' });
  for (const section of [discharges, transfers]) {
    expect(await section.locator('table').evaluate(el => getComputedStyle(el).minWidth)).toBe(
      '0px'
    );
    await expect(section.getByTitle('Abrir menú de acciones')).toBeHidden();
  }
});

test('opens the full user menu without painting a logout-only loading panel', async ({ page }) => {
  let release = () => {};
  const ready = new Promise<void>(resolve => {
    release = resolve;
  });
  await page.route('**/UserMenuPanel-*.js', async route => {
    await ready;
    await route.continue();
  });
  try {
    await seedPersistedSessionAndRecord(page);
    await page.goto('/?date=' + PREVIEW_BOOTSTRAP_DATE);
    await expectSeededPatientVisible(page);
    await page.getByTestId('authenticated-user-menu-button').click();
    await expect(page.getByTestId('authenticated-user-menu-button')).toHaveAttribute(
      'aria-expanded',
      'true'
    );
    await expect(page.getByTestId('user-profile-menu-panel')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Cerrar sesión', exact: true })).toHaveCount(0);
    release();
    const panel = page.getByTestId('user-profile-menu-panel');
    await expect(panel).toBeVisible();
    await expect(panel.getByRole('button', { name: 'Cambiar foto de perfil' })).toBeVisible();
    await expect(panel.getByRole('button', { name: 'Cerrar sesión', exact: true })).toBeVisible();
  } finally {
    release();
  }
});

test('shows transfer beds without their type suffixes', async ({ page }, testInfo) => {
  await seedPersistedSessionAndRecord(page, {
    transfers: ['MEDIA', 'INTERMEDIA'].map((bedType, index) => ({
      id: `synthetic-transfer-${index}`,
      bedId: `R${index + 6}`,
      bedName: `R${index + 6}`,
      bedType,
      patientName: `TRASLADO SINTETICO ${index + 1}`,
      rut: '',
      diagnosis: 'VALIDACION VISUAL',
      evacuationMethod: 'Ambulancia',
      receivingCenter: 'Hospital de prueba',
      movementDate: PREVIEW_BOOTSTRAP_DATE,
      time: '12:00',
    })),
  });
  await page.goto(`/?date=${PREVIEW_BOOTSTRAP_DATE}`);
  await expectSeededPatientVisible(page);
  for (const [index, bedType] of ['MEDIA', 'INTERMEDIA'].entries()) {
    const row = page.getByRole('row').filter({ hasText: `TRASLADO SINTETICO ${index + 1}` });
    await expect(row).toBeVisible();
    await expect(row.getByRole('cell').first()).toHaveText(`R${index + 6}`);
    await expect(row).not.toContainText(`(${bedType})`);
    await expect(row.getByTitle('Abrir menú de acciones')).toBeEnabled();
  }
  await testInfo.attach('transfer-rows', {
    body: await page.getByRole('row').filter({ hasText: 'TRASLADO SINTETICO 1' }).screenshot(),
    contentType: 'image/png',
  });
});

for (const width of [1440, 375]) {
  test(`plays a surprise from the independent Moa catalog without a selector or clinical reload at ${width}px`, async ({
    page,
  }) => {
    test.setTimeout(60_000);
    await page.setViewportSize({ width, height: 900 });
    const catalog = structuredClone(moaCatalogFixture);
    const hd = catalog.scenes.find(scene => scene.id === 'E08')!;
    const colors = Array.from({ length: hd.frames }, (_, i) => [
      30 + i * 7,
      130 - i * 3,
      150 + i * 4,
    ]);
    const rectangles = colors
      .map(
        (color, i) =>
          `<rect x="${i * 576}" width="576" height="336" fill="rgb(${color.join(',')})"/>`
      )
      .join('');
    const png = await sharp(
      Buffer.from(
        `<svg xmlns="http://www.w3.org/2000/svg" width="${hd.frames * 576}" height="336">${rectangles}</svg>`
      )
    )
      .png()
      .toBuffer();
    hd.sha256 = createHash('sha256').update(png).digest('hex');
    hd.bytes = png.length;
    const requests: string[] = [];
    await page.route('**/moa-library/**', async route => {
      requests.push(route.request().url());
      expect(route.request().headers()['authorization']).toBeUndefined();
      expect(route.request().headers()['cookie']).toBeUndefined();
      expect(route.request().headers()['referer']).toBeUndefined();
      if (route.request().url().endsWith('/catalog.json'))
        await route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify(catalog),
          headers: { 'access-control-allow-origin': '*' },
        });
      else
        await route.fulfill({
          contentType: 'image/png',
          body: png,
          headers: { 'access-control-allow-origin': '*' },
        });
    });
    await seedPersistedSessionAndRecord(page);
    await page.goto(`/?date=${PREVIEW_BOOTSTRAP_DATE}`);
    await expectSeededPatientVisible(page);
    expect(requests).toHaveLength(0);
    await page.locator('[data-moa-toggle]').click();
    const companion = page.getByRole('region', { name: 'Moa', exact: true });
    await expect(companion.getByRole('button')).toHaveCount(2);
    await expect(companion.getByRole('button', { name: 'Elegir animación de Moa' })).toHaveCount(0);
    await expect(companion.getByRole('listbox')).toHaveCount(0);
    await expect(companion.getByRole('dialog')).toHaveCount(0);
    await expect
      .poll(() =>
        page.evaluate(
          () => JSON.parse(localStorage.getItem('hhr_moa_catalog_v1') || 'null')?.scenes.length
        )
      )
      .toBe(222);
    expect(requests).toHaveLength(1);
    expect(requests.filter(url => url.endsWith('.png'))).toHaveLength(0);
    const close = companion.getByRole('button', { name: 'Ocultar Moa' });
    await expect(close.locator('svg')).toHaveAttribute('width', '8');
    const closeBox = await close.boundingBox();
    expect(closeBox!.width).toBeGreaterThanOrEqual(24);
    expect(closeBox!.height).toBeGreaterThanOrEqual(24);
    const character = companion.getByRole('button', { name: 'Jugar con Moa' });
    await page.evaluate(
      value => {
        Math.random = () => value;
      },
      (catalog.scenes.indexOf(hd) + 0.5) / catalog.scenes.length
    );
    await character.click();
    await expect(character).toHaveAttribute('data-gesture', hd.id);
    const frames = companion.locator('.moa-catalog-frames');
    await expect(frames).toHaveAttribute('data-ready', 'true');
    await expect(frames).toHaveCSS('image-rendering', 'auto');
    await expect(frames).toHaveCSS('transition-duration', '0s');
    await expect
      .poll(() => frames.evaluate((img: HTMLImageElement) => img.naturalWidth))
      .toBe(13824);
    expect(requests.filter(url => url.endsWith('.png'))).toHaveLength(1);
    const sequence = companion.locator('.moa-sequence');
    const visiblePixel = async () =>
      Array.from(
        await sharp(await sequence.screenshot())
          .extract({ left: 72, top: 42, width: 1, height: 1 })
          .removeAlpha()
          .raw()
          .toBuffer()
      );
    // Select the transform clock, never a transient opacity transition from the surrounding app.
    await frames.evaluate(img => {
      const a = img
        .getAnimations()
        .find(
          animation =>
            animation.effect instanceof KeyframeEffect &&
            animation.effect.getKeyframes().some(frame => frame.transform !== undefined)
        )!;
      a.pause();
      a.currentTime = 0;
    });
    await expect.poll(visiblePixel).toEqual(colors[0]);
    await frames.evaluate(
      (img, time) => {
        img.getAnimations()[0].currentTime = time;
      },
      hd.durations[0] + hd.durations[1] / 2
    );
    await expect.poll(visiblePixel).toEqual(colors[1]);
    await frames.evaluate(img => img.getAnimations()[0].play());
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, value: true });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await expect
      .poll(() => frames.evaluate(img => img.getAnimations()[0]?.playState))
      .toBe('paused');
    await page.evaluate(() => {
      Reflect.deleteProperty(document, 'hidden');
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await expect
      .poll(() =>
        frames.evaluate(img => {
          const effect = img.getAnimations()[0]?.effect as KeyframeEffect | null;
          return new Set(effect?.getKeyframes().map(frame => frame.transform)).size;
        })
      )
      .toBe(1);
    const still = await frames.evaluate(img => getComputedStyle(img).transform);
    await frames.evaluate(img => {
      img.getAnimations()[0].currentTime = 1000;
    });
    await expect(frames).toHaveCSS('transform', still);
    await frames.evaluate(img => img.getAnimations()[0].finish());
    await expect(companion.getByRole('button', { name: 'Jugar con Moa' })).toHaveAttribute(
      'data-gesture',
      'idle'
    );
    await test.info().attach(`moa-surprise-${width}px`, {
      body: await companion.screenshot(),
      contentType: 'image/png',
    });
    await character.focus();
    await page.keyboard.press('Escape');
    await expect(companion).toHaveCount(0);
    await expectSeededPatientVisible(page);
  });
}
