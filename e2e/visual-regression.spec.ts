import { test, expect, Page } from '@playwright/test';

/**
 * Visual Regression Testing Specification
 */

const VRT_DATE = '2026-01-25';

interface E2EBedRecord {
  id: string;
  bedId: string;
  patientName: string;
  rut: string;
  age: string;
  diagnosis: string;
  isOccupied: boolean;
  admissionDate: string;
  daysHospitalized: number;
  insurance: string;
  biologicalSex: 'Femenino' | 'Masculino';
  bedMode: 'Adulto';
  status: 'Estable';
}

interface E2EOverrideRecord {
  [date: string]: {
    date: string;
    beds: Record<string, E2EBedRecord>;
    lastUpdated: string;
    schemaVersion: number;
    nursesDayShift: string[];
    tensDayShift: string[];
    activeExtraBeds: string[];
  };
}

type RuntimeE2EOverride = Window['__HHR_E2E_OVERRIDE__'];

async function injectVRTData(page: Page) {
  const dateStr = VRT_DATE;
  // 1. Pipe all console logs
  page.on('console', msg => console.warn(`BROWSER LOG [${msg.type()}]: ${msg.text()}`));

  // 2. Inject specific VRT data using the built-in E2E override hook
  // We use addInitScript to ensure this is set BEFORE the app initializes.
  await page.addInitScript(
    ({ dateStr }) => {
      const records: E2EOverrideRecord = {
        [dateStr]: {
          date: dateStr,
          beds: {},
          lastUpdated: new Date().toISOString(),
          schemaVersion: 1,
          nursesDayShift: ['Enfermero VRT 1', 'Enfermero VRT 2'],
          tensDayShift: ['TENS VRT 1', 'TENS VRT 2', 'TENS VRT 3'],
          activeExtraBeds: [],
        },
      };

      // Initialize all 18 beds with dummy patient data
      // Explicitly naming the beds to match BEDS constant in the app
      const bedIds = [
        'R1',
        'R2',
        'R3',
        'R4',
        'NEO1',
        'NEO2',
        'H1C1',
        'H1C2',
        'H2C1',
        'H2C2',
        'H3C1',
        'H3C2',
        'H4C1',
        'H4C2',
        'H5C1',
        'H5C2',
        'H6C1',
        'H6C2',
      ];

      bedIds.forEach((bedId, i) => {
        records[dateStr].beds[bedId] = {
          id: bedId,
          bedId: bedId, // Some components might use bedId
          patientName: `Paciente VRT ${i + 1}`,
          rut: `12.345.678-${i + 1}`,
          age: '45',
          diagnosis: `Diagnóstico VRT para cama ${bedId}`,
          isOccupied: true,
          admissionDate: dateStr,
          daysHospitalized: i + 1,
          insurance: 'FONASA A',
          biologicalSex: i % 2 === 0 ? 'Femenino' : 'Masculino',
          bedMode: 'Adulto',
          status: 'Estable',
        };
      });

      // Set the override globally
      const runtimeWindow = window as Window & { __HHR_E2E_OVERRIDE__?: RuntimeE2EOverride };
      runtimeWindow.__HHR_E2E_OVERRIDE__ = records as unknown as RuntimeE2EOverride;

      // Also inject mock user data for login
      const mockUser = {
        uid: 'e2e-test-editor-uid',
        email: 'hospitalizados@hospitalhangaroa.cl',
        role: 'nurse_hospital',
      };
      localStorage.setItem('hhr_e2e_bootstrap_user', JSON.stringify(mockUser));

      console.warn(`[E2E] addInitScript injected override for ${dateStr}`);
    },
    { dateStr }
  );

  // 3. Navigate once and tolerate transient Firefox/WebKit navigation failures.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await page.goto(`/censo?date=${VRT_DATE}`);
      await page.waitForLoadState('domcontentloaded');
      return;
    } catch (error) {
      if (attempt === 1) {
        throw error;
      }
      await page.waitForTimeout(300);
    }
  }
}

test.describe('Visual Regression Testing', () => {
  test('Login View baseline', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText('Hospital Hanga Roa')).toBeVisible({ timeout: 10000 });
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveScreenshot('login-view.png', {
      maxDiffPixelRatio: 0.01,
      animations: 'disabled',
    });
  });

  test('Census Dashboard baseline', async ({ page }) => {
    await injectVRTData(page);

    // Wait for table to be ready
    const table = page.getByTestId('census-table');
    await expect(table).toBeVisible({ timeout: 15000 });
    await page.waitForTimeout(2000); // Wait for React render

    // Mask dynamic data
    await expect(page).toHaveScreenshot('census-dashboard.png', {
      maxDiffPixelRatio: 0.02,
      animations: 'disabled',
      mask: [
        page.locator('.text-slate-400').filter({ hasText: /:/ }), // Potential clocks
        page.locator('nav').first(),
      ],
    });
  });

  test('3D Hospital Map baseline', async ({ page }) => {
    await injectVRTData(page);

    // Find the map toggle button by title
    const mapButton = page.locator('button[title="Ver Mapa 3D"]');
    await expect(mapButton).toBeVisible({ timeout: 10000 });
    await mapButton.click();

    // Wait for 3D loader to disappear
    const loader = page.locator('text=Cargando entorno 3D');
    await expect(loader).not.toBeVisible({ timeout: 30000 });

    const canvas = page.locator('canvas');
    await expect(canvas).toBeVisible({ timeout: 10000 });

    // Extra time for Three.js textures and lighting to settle
    await page.waitForTimeout(5000);

    await expect(page).toHaveScreenshot('hospital-3d-map.png', {
      maxDiffPixelRatio: 0.1,
      mask: [page.locator('.lucide-search'), page.locator('.lucide-box')], // Mask transient UI
    });
  });

  test('Patient Dialog UI baseline', async ({ page }) => {
    await injectVRTData(page);

    // Wait for table to be ready
    const table = page.getByTestId('census-table');
    await expect(table).toBeVisible({ timeout: 15000 });

    // Wait for data to load in the table - Use bed ID 'R1' which is stable text
    const patientRow = page.locator('tr').filter({ hasText: 'R1' });
    await expect(patientRow).toBeVisible({ timeout: 15000 });

    // Open the demographics modal from the patient row action button
    const demographicsButton = patientRow.getByRole('button', { name: /Datos del Paciente/i });
    await expect(demographicsButton).toBeVisible({ timeout: 10000 });
    await demographicsButton.click();

    const dialog = page.getByRole('dialog').first();
    await expect(dialog).toBeVisible({ timeout: 10000 });

    // Give time for animations
    await page.waitForTimeout(1000);

    await expect(dialog).toHaveScreenshot('patient-demographics-dialog.png', {
      maxDiffPixelRatio: 0.05,
    });
  });

  // ────────────────────────────────────────────────────────────────────────
  // VRT coverage gaps (PDF audit, P1-2). The specs below are codified TODOs
  // for the next VRT pass: they exercise destructive confirm dialogs and
  // medical handoff surfaces — both flagged by the audit as needing visual
  // evidence under pressure. They use test.fixme so:
  //   - the contract is visible in code (not in a backlog ticket),
  //   - typecheck and CI stay green without baselines,
  //   - whoever runs the next baseline pass discovers them via Playwright's
  //     "fixme" report instead of having to re-derive scope from docs.
  // See docs/testing/VRT.md for the regeneration flow.
  // ────────────────────────────────────────────────────────────────────────

  test.fixme('Destructive confirm dialog (warning variant)', async ({ page }) => {
    // Target: useConfirmDialog rendering for variant 'warning' (e.g. the
    // Optimizar Base de Datos confirm in ConsolidationManager).
    // Asserts that the warning palette, the confirm/cancel button labels
    // and the destructive icon stay stable. Pending baseline generation
    // and a deterministic admin-route fixture without Firebase access.
    await page.goto('/');
  });

  test.fixme('Destructive confirm dialog (danger variant)', async ({ page }) => {
    // Target: useConfirmDialog rendering for variant 'danger' (e.g. the
    // Limpiar Registro confirm in ErrorDashboard, plus the cancel-transfer
    // modal). Asserts the irreversible-action copy, the danger palette and
    // the disabled-while-empty submit button.
    await page.goto('/');
  });

  test.fixme('Medical handoff signed view baseline', async ({ page }) => {
    // Target: the medical handoff after a signature, including the audit
    // banner ('firmado por …') and the read-only patient strip. The audit
    // (PDF P1-2) calls this surface out as critical UX evidence under
    // pressure: the clinician relying on it must see signature + actor
    // + lock affordance unambiguously.
    await page.goto('/');
  });
});
