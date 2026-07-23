import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { ensureRecordExists } from './fixtures/auth';
import { installPreviewFirebaseRuntime } from './fixtures/previewFirebase';

const FLOW_BUDGETS_PATH = path.join(
  process.cwd(),
  'scripts',
  'config',
  'flow-performance-budgets.json'
);
const FLOW_REPORT_PATH = path.join(process.cwd(), 'reports', 'e2e', 'flow-performance-budget.json');

interface FlowBudgetDefinition {
  enforcedMaxMs: number;
  targetMs: number;
}

interface FlowBudgetConfig {
  flows?: Record<string, FlowBudgetDefinition>;
}

type BrowserName = 'chromium' | 'firefox' | 'webkit';

const readFlowBudgets = (): FlowBudgetConfig => {
  if (!fs.existsSync(FLOW_BUDGETS_PATH)) {
    return {};
  }

  try {
    return JSON.parse(fs.readFileSync(FLOW_BUDGETS_PATH, 'utf8')) as FlowBudgetConfig;
  } catch {
    return {};
  }
};

const parseBudgetFromEnv = (key: string, fallback: number): number => {
  const raw = process.env[key];
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const configuredBudgets = readFlowBudgets().flows || {};
const resolveBudget = (
  key: string,
  envKey: string,
  fallback: FlowBudgetDefinition
): FlowBudgetDefinition => {
  const configured = configuredBudgets[key];
  return {
    enforcedMaxMs: parseBudgetFromEnv(envKey, configured?.enforcedMaxMs ?? fallback.enforcedMaxMs),
    targetMs: configured?.targetMs ?? fallback.targetMs,
  };
};

const BUDGETS = {
  loginVisibleMs: resolveBudget('loginVisibleMs', 'E2E_BUDGET_LOGIN_VISIBLE_MS', {
    enforcedMaxMs: 4000,
    targetMs: 4000,
  }),
  authFeedbackMs: resolveBudget('authFeedbackMs', 'E2E_BUDGET_AUTH_FEEDBACK_MS', {
    enforcedMaxMs: 2500,
    targetMs: 2500,
  }),
  censoVisibleMs: resolveBudget('censoVisibleMs', 'E2E_BUDGET_CENSO_VISIBLE_MS', {
    enforcedMaxMs: 2000,
    targetMs: 1500,
  }),
  censoRecordReadyMs: resolveBudget('censoRecordReadyMs', 'E2E_BUDGET_CENSO_RECORD_READY_MS', {
    enforcedMaxMs: 5000,
    targetMs: 2500,
  }),
  clinicalDocumentsVisibleMs: resolveBudget(
    'clinicalDocumentsVisibleMs',
    'E2E_BUDGET_CLINICAL_DOCUMENTS_VISIBLE_MS',
    {
      enforcedMaxMs: 6000,
      targetMs: 4500,
    }
  ),
  backupFilesVisibleMs: resolveBudget(
    'backupFilesVisibleMs',
    'E2E_BUDGET_BACKUP_FILES_VISIBLE_MS',
    {
      enforcedMaxMs: 4500,
      targetMs: 4500,
    }
  ),
  logoutToLoginVisibleMs: resolveBudget(
    'logoutToLoginVisibleMs',
    'E2E_BUDGET_LOGOUT_TO_LOGIN_VISIBLE_MS',
    {
      enforcedMaxMs: 2500,
      targetMs: 1500,
    }
  ),
} as const;

const BROWSER_BUDGET_OVERRIDES: Partial<
  Record<BrowserName, Partial<Record<keyof typeof BUDGETS, number>>>
> = {
  firefox: {
    censoVisibleMs: 6000,
  },
  webkit: {
    censoVisibleMs: 6000,
  },
};

const getEnforcedBudget = (browserName: string, key: keyof typeof BUDGETS): number => {
  const browserOverride = BROWSER_BUDGET_OVERRIDES[browserName as BrowserName]?.[key];
  return browserOverride ?? BUDGETS[key].enforcedMaxMs;
};

const CURRENT_DATE = '2026-02-20';
const usePreviewMode = process.env.PLAYWRIGHT_USE_PREVIEW === '1';
const flowMetrics: Record<string, number> = {};
const censoBreakdown: Record<string, number | string> = {};
const clinicalDocumentsBreakdown: Record<string, number> = {};

const bootstrapRecordAndUser = async (
  page: Parameters<typeof ensureRecordExists>[0],
  dateStr: string
) => {
  await page.addInitScript(
    ({ bootstrapDate }: { bootstrapDate: string }) => {
      const existing = JSON.parse(localStorage.getItem('hanga_roa_hospital_data') || '{}');
      if (!existing[bootstrapDate]) {
        existing[bootstrapDate] = {
          date: bootstrapDate,
          beds: {
            R1: {
              id: 'R1',
              bedId: 'R1',
              patientName: 'PERF TEST',
              rut: '12.345.678-5',
              age: '45a',
              pathology: 'Control',
              specialty: 'Medicina',
              status: 'ESTABLE',
              admissionDate: bootstrapDate,
              devices: [],
              isBlocked: false,
              isUPC: false,
            },
          },
          discharges: [],
          transfers: [],
          cma: [],
          nurses: ['', ''],
          nursesDayShift: ['', ''],
          nursesNightShift: ['', ''],
          tensDayShift: ['', ''],
          lastUpdated: `${bootstrapDate}T12:00:00.000Z`,
          activeExtraBeds: [],
          schemaVersion: 1,
        };
      }
      const record = existing[bootstrapDate];
      localStorage.setItem('hanga_roa_hospital_data', JSON.stringify(existing));
      (
        window as unknown as { __HHR_E2E_OVERRIDE__?: Record<string, unknown> }
      ).__HHR_E2E_OVERRIDE__ = {
        ...((window as unknown as { __HHR_E2E_OVERRIDE__?: Record<string, unknown> })
          .__HHR_E2E_OVERRIDE__ || {}),
        [bootstrapDate]: record,
      };
      localStorage.setItem(
        'hhr_e2e_bootstrap_user',
        JSON.stringify({
          uid: 'perf-user',
          email: 'perf@hospital.cl',
          displayName: 'Perf User',
          role: 'admin',
        })
      );
    },
    { bootstrapDate: dateStr }
  );
};

const waitForCensoReady = async (page: Parameters<typeof ensureRecordExists>[0]) => {
  const candidates = [
    page.getByTestId('census-table').first(),
    page.getByTestId('blank-record-btn').first(),
    page.getByText(/No existe registro para esta fecha/i, { exact: false }).first(),
  ];

  await expect
    .poll(
      async () => {
        for (const candidate of candidates) {
          if (await candidate.isVisible().catch(() => false)) {
            return true;
          }
        }
        return false;
      },
      { timeout: 5000 }
    )
    .toBe(true);
};

const readCensoOperationalPhase = async (
  page: Parameters<typeof ensureRecordExists>[0]
): Promise<string> => {
  const operationalBanner = page.getByTestId('census-operational-state-banner').first();
  if (!(await operationalBanner.isVisible({ timeout: 250 }).catch(() => false))) {
    return 'remote_confirmed_or_no_banner';
  }
  return (await operationalBanner.getAttribute('data-phase')) || 'unknown_visible_banner';
};

const expectCensoOperationalTransition = async (
  page: Parameters<typeof ensureRecordExists>[0],
  initialPhase: string
) => {
  if (initialPhase !== 'remote_confirmed_or_no_banner') {
    expect(
      initialPhase,
      `initial census operational phase should be pending, received ${initialPhase}`
    ).toMatch(/^(loading_remote|sync_pending|reconciling_remote|using_local_cache)$/);
  }

  const seededPatientRow = page.locator('[data-testid="patient-row"][data-bed-id="R1"]').first();
  const seededPatientName = seededPatientRow.locator('input[name="patientName"]').first();

  await expect(page.getByTestId('census-table')).toBeVisible();
  await expect(seededPatientRow).toBeVisible();
  await expect(seededPatientName).toHaveValue('PERF TEST');

  const operationalBanner = page.getByTestId('census-operational-state-banner').first();
  if (await operationalBanner.isVisible({ timeout: 250 }).catch(() => false)) {
    const currentPhase = (await operationalBanner.getAttribute('data-phase')) || 'unknown';
    expect(
      currentPhase,
      `visible census operational phase should be non-blocking after the record is usable, received ${currentPhase}`
    ).toMatch(/^(loading_remote|sync_pending|reconciling_remote|using_local_cache)$/);
  }
};

const dismissBlockingOperationalBanner = async (page: Parameters<typeof ensureRecordExists>[0]) => {
  const closeButton = page.getByRole('button', { name: /^Cerrar$/i }).last();
  if (await closeButton.isVisible().catch(() => false)) {
    await closeButton.click({ force: true });
  }
};

const waitForBackupFilesReady = async (page: Parameters<typeof ensureRecordExists>[0]) => {
  await dismissBlockingOperationalBanner(page);
  await expect(page.getByTestId('backup-files-view')).toBeVisible();
};

const waitForClinicalDocumentsReady = async (page: Parameters<typeof ensureRecordExists>[0]) => {
  await expect(page.getByTestId('clinical-documents-workspace')).toBeVisible();
};

const revealPatientRowQuickActions = async (
  page: Parameters<typeof ensureRecordExists>[0],
  patientRow: ReturnType<Parameters<typeof ensureRecordExists>[0]['locator']>
) => {
  const demographicsButton = patientRow.getByRole('button', { name: /Datos del Paciente/i });
  await demographicsButton.focus();
  await expect(page.getByLabel('Acciones clínicas rápidas')).toBeVisible();
};

test.afterAll(async () => {
  fs.mkdirSync(path.dirname(FLOW_REPORT_PATH), { recursive: true });
  fs.writeFileSync(
    FLOW_REPORT_PATH,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        status: 'measured',
        budgets: BUDGETS,
        metrics: flowMetrics,
        breakdown: {
          censo: censoBreakdown,
          clinicalDocuments: clinicalDocumentsBreakdown,
        },
        targetViolations: Object.entries(flowMetrics)
          .filter(([key, value]) => value > (BUDGETS[key as keyof typeof BUDGETS]?.targetMs ?? 0))
          .map(([key, value]) => ({
            flow: key,
            actualMs: value,
            targetMs: BUDGETS[key as keyof typeof BUDGETS]?.targetMs ?? null,
          })),
      },
      null,
      2
    )
  );
});

test.describe('Startup performance budget', () => {
  test('meets login, auth, censo, clinical documents, backup, and logout visibility budgets', async ({
    page,
    browserName,
  }) => {
    if (usePreviewMode) {
      await installPreviewFirebaseRuntime(page);
    }

    const startLogin = performance.now();
    await page.goto('/');
    const loginButton = page.getByTestId('login-google-button');
    await expect(loginButton).toBeVisible();
    const loginVisibleMs = performance.now() - startLogin;
    flowMetrics.loginVisibleMs = Number(loginVisibleMs.toFixed(2));

    await page.evaluate(() => {
      window.localStorage.setItem(
        'hhr_google_login_lock_v1',
        JSON.stringify({ owner: 'other-tab', timestamp: 1763568000000 })
      );
    });

    const startAuthFeedback = performance.now();
    await loginButton.click();
    await expect(page.getByTestId('login-page')).toHaveAttribute(
      'data-auth-state',
      'google-loading'
    );
    const authFeedbackMs = performance.now() - startAuthFeedback;
    flowMetrics.authFeedbackMs = Number(authFeedbackMs.toFixed(2));
    await bootstrapRecordAndUser(page, CURRENT_DATE);

    const startCenso = performance.now();
    await page.goto(`/censo?date=${CURRENT_DATE}`, { waitUntil: 'domcontentloaded' });
    censoBreakdown.navigationMs = Number((performance.now() - startCenso).toFixed(2));
    const startCensoReady = performance.now();
    await waitForCensoReady(page);
    const censoVisibleMs = performance.now() - startCenso;
    censoBreakdown.readyStateMs = Number((performance.now() - startCensoReady).toFixed(2));
    flowMetrics.censoVisibleMs = Number(censoVisibleMs.toFixed(2));
    const initialCensoOperationalPhase = await readCensoOperationalPhase(page);
    censoBreakdown.operationalPhase = initialCensoOperationalPhase;
    const startEnsureRecord = performance.now();
    await ensureRecordExists(page);
    await expectCensoOperationalTransition(page, initialCensoOperationalPhase);
    const censoRecordReadyMs = performance.now() - startEnsureRecord;
    censoBreakdown.ensureRecordMs = Number((performance.now() - startEnsureRecord).toFixed(2));
    flowMetrics.censoRecordReadyMs = Number(censoRecordReadyMs.toFixed(2));

    const patientRow = page.locator('[data-testid="patient-row"][data-bed-id="R1"]').first();
    const openClinicalDocumentsMenuStart = performance.now();
    await revealPatientRowQuickActions(page, patientRow);
    await page.getByLabel('Acciones clínicas rápidas').click();
    clinicalDocumentsBreakdown.openMenuMs = Number(
      (performance.now() - openClinicalDocumentsMenuStart).toFixed(2)
    );
    await expect(page.getByTitle('Documentos clínicos')).toBeVisible();

    const startClinicalDocuments = performance.now();
    await page.getByTitle('Documentos clínicos').click();
    await waitForClinicalDocumentsReady(page);
    const clinicalDocumentsVisibleMs = performance.now() - startClinicalDocuments;
    clinicalDocumentsBreakdown.workspaceReadyMs = Number(clinicalDocumentsVisibleMs.toFixed(2));
    flowMetrics.clinicalDocumentsVisibleMs = Number(clinicalDocumentsVisibleMs.toFixed(2));

    const startBackupFiles = performance.now();
    await page.goto('/?module=BACKUP_FILES');
    await waitForBackupFilesReady(page);
    const backupFilesVisibleMs = performance.now() - startBackupFiles;
    flowMetrics.backupFilesVisibleMs = Number(backupFilesVisibleMs.toFixed(2));

    // Manual logout must return the user to a usable login screen quickly —
    // this guards the "logout looks broken" regression class.
    const userMenuButton = page.getByTestId('authenticated-user-menu-button');
    await expect(userMenuButton).toBeVisible();
    await userMenuButton.click();
    const logoutButton = page.getByRole('button', { name: /Cerrar sesión/i });
    await expect(logoutButton).toBeVisible();
    const startLogout = performance.now();
    await logoutButton.click();
    await expect(page.getByTestId('login-google-button')).toBeVisible();
    const logoutToLoginVisibleMs = performance.now() - startLogout;
    flowMetrics.logoutToLoginVisibleMs = Number(logoutToLoginVisibleMs.toFixed(2));

    expect(loginVisibleMs, `loginVisibleMs=${loginVisibleMs}`).toBeLessThanOrEqual(
      getEnforcedBudget(browserName, 'loginVisibleMs')
    );
    expect(authFeedbackMs, `authFeedbackMs=${authFeedbackMs}`).toBeLessThanOrEqual(
      getEnforcedBudget(browserName, 'authFeedbackMs')
    );
    expect(censoVisibleMs, `censoVisibleMs=${censoVisibleMs}`).toBeLessThanOrEqual(
      getEnforcedBudget(browserName, 'censoVisibleMs')
    );
    expect(censoRecordReadyMs, `censoRecordReadyMs=${censoRecordReadyMs}`).toBeLessThanOrEqual(
      getEnforcedBudget(browserName, 'censoRecordReadyMs')
    );
    expect(
      clinicalDocumentsVisibleMs,
      `clinicalDocumentsVisibleMs=${clinicalDocumentsVisibleMs}`
    ).toBeLessThanOrEqual(getEnforcedBudget(browserName, 'clinicalDocumentsVisibleMs'));
    expect(
      backupFilesVisibleMs,
      `backupFilesVisibleMs=${backupFilesVisibleMs}`
    ).toBeLessThanOrEqual(getEnforcedBudget(browserName, 'backupFilesVisibleMs'));
    expect(
      logoutToLoginVisibleMs,
      `logoutToLoginVisibleMs=${logoutToLoginVisibleMs}`
    ).toBeLessThanOrEqual(getEnforcedBudget(browserName, 'logoutToLoginVisibleMs'));
  });
});
