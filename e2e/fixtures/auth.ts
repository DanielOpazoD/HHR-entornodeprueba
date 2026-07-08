/**
 * E2E Test Fixtures
 * Provides authentication helpers for E2E tests.
 * Uses localStorage injection to mock authenticated users.
 */

import { expect, Page } from '@playwright/test';

export const E2E_DEFAULT_DATE = process.env.E2E_FIXED_DATE ?? '2026-01-01';
const RECORD_LAST_UPDATED = `${E2E_DEFAULT_DATE}T00:00:00.000Z`;

// Mock user data for different roles
export const MOCK_USERS = {
  editor: {
    uid: 'e2e-test-editor-uid',
    email: 'hospitalizados@hospitalhangaroa.cl',
    displayName: 'E2E Test Editor',
    role: 'nurse_hospital',
  },
  admin: {
    uid: 'e2e-test-admin-uid',
    email: 'daniel.opazo@hospitalhangaroa.cl',
    displayName: 'E2E Test Admin',
    role: 'admin',
  },
  viewer: {
    uid: 'e2e-test-viewer-uid',
    email: 'd.opazo.damiani@gmail.com',
    displayName: 'E2E Test Viewer',
    role: 'doctor_urgency',
  },
};

type E2ERole = keyof typeof MOCK_USERS;

interface BootstrapSeededRecordOptions {
  role?: E2ERole;
  date?: string;
  record: Record<string, unknown>;
  useRuntimeOverride?: boolean;
  forceEditableRecord?: boolean;
}

const BASE_BED_IDS = [
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
  'E1',
  'E2',
  'E3',
  'E4',
  'E5',
] as const;

const createEmptyBed = (bedId: string) => ({
  id: bedId,
  bedId,
  patientName: '',
  rut: '',
  isBlocked: false,
  bedMode: 'Adulto',
  hasCompanionCrib: false,
  devices: [],
  status: '',
  pathology: '',
  specialty: '',
  age: '',
  admissionDate: E2E_DEFAULT_DATE,
  hasWristband: false,
  surgicalComplication: false,
  isUPC: false,
});

export const buildCanonicalE2ERecord = (
  date: string,
  overrides: Record<string, unknown> = {}
): Record<string, unknown> => {
  const beds = Object.fromEntries(BASE_BED_IDS.map(id => [id, createEmptyBed(id)]));
  return {
    date,
    beds,
    discharges: [],
    transfers: [],
    cma: [],
    lastUpdated: `${date}T12:00:00.000Z`,
    nurses: ['Dr. Sender', 'Enf. A'],
    nursesDayShift: ['Dr. Sender', 'Enf. A'],
    nursesNightShift: ['Enf. Night', 'Enf. Cover'],
    tensDayShift: ['', '', ''],
    tensNightShift: ['', '', ''],
    handoffNightReceives: ['Enf. Night', 'Enf. Cover'],
    activeExtraBeds: [],
    schemaVersion: 1,
    ...overrides,
  };
};

export const buildLegacyE2ERecord = (
  date: string,
  overrides: Record<string, unknown> = {}
): Record<string, unknown> => {
  const canonical = buildCanonicalE2ERecord(date);
  const beds = {
    ...(canonical.beds as Record<string, Record<string, unknown>>),
    R1: {
      ...(canonical.beds as Record<string, Record<string, unknown>>).R1,
      patientName: 'LEGACY PATIENT',
      rut: '12345678-5',
      pathology: 'LEGACY DX',
      status: 'Estable',
      age: '45',
      admissionDate: date,
    },
    E1: {
      ...(canonical.beds as Record<string, Record<string, unknown>>).E1,
      patientName: 'EXTRA BED LEGACY',
      rut: '11111111-1',
      pathology: 'EXTRA BED DX',
      status: 'De cuidado',
      age: '53',
      admissionDate: date,
      location: 'Extra',
    },
  };

  return {
    date,
    beds,
    discharges: [],
    transfers: [],
    cma: [],
    lastUpdated: `${date}T01:00:00.000Z`,
    nurses: ['Legacy Nurse'],
    activeExtraBeds: ['E1'],
    ...overrides,
  };
};

/**
 * Helper to inject authenticated user AND mock data in a single setup step.
 * This is more efficient and reliable than calling them separately.
 */
export async function setupE2EContext(
  page: Page,
  role: 'editor' | 'admin' | 'viewer' = 'editor',
  populateWithPatient: boolean = false,
  targetDateOverride?: string
) {
  const mockUser = MOCK_USERS[role];
  const targetDate = targetDateOverride || E2E_DEFAULT_DATE;

  await page.addInitScript(() => {
    const runtimeWindow = window as Window & { __HHR_E2E_OVERRIDE__?: Record<string, unknown> };
    const remoteShadow = localStorage.getItem('hhr_e2e_remote_override_shadow');
    if (remoteShadow) {
      const parsed = JSON.parse(remoteShadow) as { date: string; record: unknown };
      runtimeWindow.__HHR_E2E_OVERRIDE__ = { [parsed.date]: parsed.record };
      return;
    }
    runtimeWindow.__HHR_E2E_OVERRIDE__ = {};
  });

  // 1. Navigate to home
  await page.goto('/');

  // 2. Inject everything at once
  await page.evaluate(
    ({
      user,
      dateStr,
      populate,
      lastUpdated,
    }: {
      user: typeof mockUser;
      dateStr: string;
      populate: boolean;
      lastUpdated: string;
    }) => {
      // Store auth
      localStorage.setItem('hhr_e2e_bootstrap_user', JSON.stringify(user));
      localStorage.removeItem('hhr_e2e_force_local_only_sync');

      // Store Record Data
      const STORAGE_KEY = 'hanga_roa_hospital_data';
      const mockRecord = {
        date: dateStr,
        beds: {} as Record<string, unknown>,
        discharges: [],
        transfers: [],
        cma: [],
        lastUpdated,
        nurses: ['Dr. Sender', 'Enf. A'],
        activeExtraBeds: [],
      };

      const BEDS_IDS = [
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
        'E1',
        'E2',
        'E3',
        'E4',
        'E5',
      ];

      BEDS_IDS.forEach(id => {
        mockRecord.beds[id] = {
          id,
          bedId: id,
          patientName: populate && id === 'R1' ? 'MOCK PATIENT' : '',
          rut: populate && id === 'R1' ? '12345678' : '',
          isBlocked: false,
          bedMode: 'Adulto',
          hasCompanionCrib: false,
          devices: [],
          status: 'Estable',
          pathology: populate && id === 'R1' ? 'MOCK DIAGNOSIS' : '',
          specialty: '',
          age: populate && id === 'R1' ? '45' : '',
          admissionDate: dateStr,
          hasWristband: false,
          surgicalComplication: false,
          isUPC: false,
        };
      });

      const records = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
      records[dateStr] = mockRecord;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
    },
    {
      user: mockUser,
      dateStr: targetDate,
      populate: populateWithPatient,
      lastUpdated: RECORD_LAST_UPDATED,
    }
  );

  // 3. Single reload to apply all state
  try {
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes('Frame load interrupted')) {
      throw error;
    }
    await page.waitForLoadState('domcontentloaded', { timeout: 30000 }).catch(() => {});
  }

  // Refuerzo: esperar a que no haya llamadas de red pendientes agresivas
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
  await page.waitForLoadState('domcontentloaded');

  // 4. If login screen is still visible, complete deterministic E2E popup login
  const googleLoginButton = page.getByTestId('login-google-button');
  const loginVisible = await googleLoginButton.isVisible({ timeout: 2000 }).catch(() => false);

  if (loginVisible) {
    await page.evaluate(
      ({ user }) => {
        localStorage.removeItem('hhr_google_login_lock_v1');
        localStorage.setItem('hhr_e2e_force_popup', 'true');
        localStorage.setItem(
          'hhr_e2e_popup_success_user',
          JSON.stringify({
            uid: user.uid,
            email: user.email,
            displayName: user.displayName,
            role: user.role,
          })
        );
      },
      { user: mockUser }
    );

    await googleLoginButton.click();

    await Promise.race([
      page
        .getByTestId('census-table')
        .waitFor({ state: 'visible', timeout: 15000 })
        .catch(() => {}),
      page
        .getByRole('button', { name: /Ingresar con Google/i })
        .waitFor({ state: 'hidden', timeout: 15000 })
        .catch(() => {}),
    ]);
  }
}

/**
 * Legacy helpers (maintained for compatibility if needed, but setupE2EContext is preferred)
 */
export async function injectMockUser(page: Page, role: 'editor' | 'admin' | 'viewer' = 'editor') {
  await setupE2EContext(page, role);
}

export async function injectMockData(
  page: Page,
  date?: string,
  populateWithPatient: boolean = false
) {
  // If we're already on the page, inject data without reload to preserve auth/session state
  const targetDate = date || E2E_DEFAULT_DATE;
  await page.addInitScript(() => {
    (window as Window & { __HHR_E2E_OVERRIDE__?: Record<string, unknown> }).__HHR_E2E_OVERRIDE__ =
      {};
  });
  await page.evaluate(
    ({ dateStr, _populate }: { dateStr: string; _populate: boolean }) => {
      const STORAGE_KEY = 'hanga_roa_hospital_data';
      // ... (simplified version for legacy support)
      const records = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
      if (!records[dateStr]) {
        records[dateStr] = { date: dateStr, beds: {}, discharges: [], transfers: [], cma: [] };
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
    },
    { dateStr: targetDate, _populate: populateWithPatient }
  );
}

export async function bootstrapSeededRecord(
  page: Page,
  {
    role = 'admin',
    date = E2E_DEFAULT_DATE,
    record,
    useRuntimeOverride = true,
    forceEditableRecord = true,
  }: BootstrapSeededRecordOptions
) {
  const mockUser = MOCK_USERS[role];

  await page.addInitScript(
    ({
      user,
      editableRecordOverride,
    }: {
      user: typeof mockUser;
      editableRecordOverride: boolean;
    }) => {
      localStorage.setItem('hhr_e2e_bootstrap_user', JSON.stringify(user));
      localStorage.setItem('hhr_e2e_force_local_only_sync', 'true');
      if (editableRecordOverride) {
        localStorage.setItem('hhr_e2e_force_editable_record', 'true');
      } else {
        localStorage.removeItem('hhr_e2e_force_editable_record');
      }
      localStorage.setItem('hhr_db_initialized', 'true');

      const runtimeWindow = window as Window & {
        __HHR_E2E_OVERRIDE__?: Record<string, unknown>;
      };
      const remoteShadow = localStorage.getItem('hhr_e2e_remote_override_shadow');
      if (remoteShadow) {
        const parsed = JSON.parse(remoteShadow) as { date: string; record: unknown };
        runtimeWindow.__HHR_E2E_OVERRIDE__ = { [parsed.date]: parsed.record };
        return;
      }
      // Keep the E2E runtime flag enabled for auth/bootstrap while forcing record
      // reads through the persisted storage stack after the seeded reload.
      runtimeWindow.__HHR_E2E_OVERRIDE__ = {};
    },
    {
      user: mockUser,
      editableRecordOverride: forceEditableRecord,
    }
  );

  await page.goto('/', { waitUntil: 'domcontentloaded' });

  await page.evaluate(
    ({
      dateStr,
      seededRecord,
      runtimeOverride,
      editableRecordOverride,
    }: {
      dateStr: string;
      seededRecord: Record<string, unknown>;
      runtimeOverride: boolean;
      editableRecordOverride: boolean;
    }) => {
      const STORAGE_KEY = 'hanga_roa_hospital_data';
      const records = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') as Record<
        string,
        Record<string, unknown>
      >;

      records[dateStr] = seededRecord;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
      localStorage.setItem('hhr_db_initialized', 'true');
      localStorage.setItem('hhr_e2e_force_local_only_sync', 'true');
      localStorage.removeItem('indexeddb_migration_complete');

      if (editableRecordOverride) {
        localStorage.setItem('hhr_e2e_force_editable_record', 'true');
      } else {
        localStorage.removeItem('hhr_e2e_force_editable_record');
      }

      const runtimeWindow = window as Window & {
        __HHR_E2E_OVERRIDE__?: Record<string, unknown>;
      };

      if (runtimeOverride) {
        runtimeWindow.__HHR_E2E_OVERRIDE__ = {
          ...(runtimeWindow.__HHR_E2E_OVERRIDE__ || {}),
        };
      } else {
        runtimeWindow.__HHR_E2E_OVERRIDE__ = {};
      }
    },
    {
      dateStr: date,
      seededRecord: record,
      runtimeOverride: useRuntimeOverride,
      editableRecordOverride: forceEditableRecord,
    }
  );

  try {
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes('Frame load interrupted')) {
      throw error;
    }
    await page.waitForLoadState('domcontentloaded', { timeout: 30000 }).catch(() => {});
  }

  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
  await page.waitForLoadState('domcontentloaded');
}

export async function ensureAuthenticated(page: Page) {
  const loginButton = page.getByRole('button', { name: /Ingresar con Google/i });
  const loginButtonById = page.getByTestId('login-google-button');

  if (
    !(await loginButtonById.isVisible().catch(() => false)) &&
    !(await loginButton.isVisible().catch(() => false))
  ) {
    return;
  }

  await page.evaluate(() => {
    localStorage.removeItem('hhr_google_login_lock_v1');
    localStorage.setItem('hhr_e2e_force_popup', 'true');
    localStorage.setItem(
      'hhr_auth_bootstrap_pending_v1',
      JSON.stringify({
        startedAt: Date.now(),
        mode: 'redirect',
        returnTo: `${window.location.pathname}${window.location.search}${window.location.hash}`,
      })
    );

    const bootstrapUserRaw = localStorage.getItem('hhr_e2e_bootstrap_user');
    if (bootstrapUserRaw) {
      localStorage.setItem('hhr_e2e_popup_success_user', bootstrapUserRaw);
    }
  });

  await loginButtonById.click();
  await expect
    .poll(
      async () =>
        page.evaluate(() => ({
          popupUserPending: window.localStorage.getItem('hhr_e2e_popup_success_user'),
          loginButtonVisible: Boolean(
            document.querySelector('[data-testid="login-google-button"]')
          ),
        })),
      { timeout: 15000 }
    )
    .toMatchObject({
      popupUserPending: null,
    });
}

export async function installClipboardCapture(page: Page) {
  await page.addInitScript(() => {
    const runtimeWindow = window as Window & {
      __HHR_LAST_CLIPBOARD__?: string;
    };

    const clipboard = navigator.clipboard || ({} as Clipboard);
    const nextClipboard = {
      ...clipboard,
      writeText: async (value: string) => {
        runtimeWindow.__HHR_LAST_CLIPBOARD__ = value;
      },
      readText: async () => runtimeWindow.__HHR_LAST_CLIPBOARD__ || '',
    };

    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: nextClipboard,
    });
  });
}

export async function getCapturedClipboardText(page: Page): Promise<string> {
  return page.evaluate(() => {
    const runtimeWindow = window as Window & {
      __HHR_LAST_CLIPBOARD__?: string;
    };
    return runtimeWindow.__HHR_LAST_CLIPBOARD__ || '';
  });
}

export async function readIndexedDbDailyRecord(page: Page, date: string) {
  return page.evaluate(async targetDate => {
    const request = indexedDB.open('HangaRoaDB');

    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });

    const transaction = db.transaction('dailyRecords', 'readonly');
    const store = transaction.objectStore('dailyRecords');
    const getRequest = store.get(targetDate);

    const record = await new Promise<unknown>((resolve, reject) => {
      getRequest.onerror = () => reject(getRequest.error);
      getRequest.onsuccess = () => resolve(getRequest.result ?? null);
    });

    db.close();
    return record;
  }, date);
}

/**
 * Helper to clear authentication
 */
export async function clearAuth(page: Page) {
  await page.evaluate(() => {
    localStorage.removeItem('hhr_e2e_bootstrap_user');
    localStorage.removeItem('hhr_e2e_force_editable_record');
  });
}

/**
 * Helper to ensure a record exists for current day
 * Uses stable data-testid instead of text selectors
 */
export async function ensureRecordExists(page: Page) {
  const initialStateTimeoutMs = 45_000;
  const loginButton = page.getByRole('button', { name: /Ingresar con Google/i });
  const loginButtonById = page.getByTestId('login-google-button');
  if (
    (await loginButtonById.isVisible().catch(() => false)) ||
    (await loginButton.isVisible().catch(() => false))
  ) {
    await page.evaluate(() => {
      localStorage.removeItem('hhr_google_login_lock_v1');
      localStorage.setItem('hhr_e2e_force_popup', 'true');
      localStorage.setItem('hhr_db_initialized', 'true');

      const bootstrapUserRaw = localStorage.getItem('hhr_e2e_bootstrap_user');
      if (bootstrapUserRaw) {
        localStorage.setItem('hhr_e2e_popup_success_user', bootstrapUserRaw);
      }
    });
    await loginButtonById.click();
    await expect(loginButtonById).toBeHidden({ timeout: 15000 });
  }

  const tableById = page.getByTestId('census-table');
  const blankBtn = page
    .getByRole('button', { name: /Comenzar Día|Registro en Blanco|Iniciar turno desde cero/i })
    .first();
  const copyBtn = page.getByRole('button', { name: /Copiar día anterior/i }).first();
  const hasVisibleCreatePrompt = async () =>
    (await blankBtn.isVisible().catch(() => false)) ||
    (await copyBtn.isVisible().catch(() => false));

  if (await tableById.isVisible().catch(() => false)) {
    return;
  }

  await page.waitForLoadState('domcontentloaded');

  if (await tableById.isVisible().catch(() => false)) {
    return;
  }

  if (await hasVisibleCreatePrompt()) {
    // El prompt visible ya implica que la pantalla está lista para interactuar.
  } else {
    // Solo esperar quietud de red si todavía no apareció ni tabla ni prompt.
    await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});

    if (await tableById.isVisible().catch(() => false)) {
      return;
    }
  }

  try {
    // Si la tabla no cargó, uno de estos DEBE estar.
    await expect
      .poll(
        async () => {
          if (await tableById.isVisible().catch(() => false)) return 'table';
          if (await blankBtn.isVisible().catch(() => false)) return 'blank';
          if (await copyBtn.isVisible().catch(() => false)) return 'copy';
          return 'pending';
        },
        { timeout: initialStateTimeoutMs }
      )
      .toMatch(/table|blank|copy/);
  } catch {
    // Fallback: si aun así no está, vemos si en el ínterin apareció la tabla
    if (await tableById.isVisible().catch(() => false)) return;
    throw new Error('Timeout waiting for census initial state (table or create buttons)');
  }

  if (await blankBtn.isVisible().catch(() => false)) {
    await blankBtn.click();
    const confirmationInput = page.getByRole('textbox', { name: /Registroenblanco/i }).first();
    if (await confirmationInput.isVisible().catch(() => false)) {
      await confirmationInput.fill('Registroenblanco');
      await page.getByRole('button', { name: /Aceptar/i }).click();
    }
  } else if (await copyBtn.isVisible().catch(() => false)) {
    await copyBtn.click();
  }

  // Final confirmation
  await expect(tableById).toBeVisible({ timeout: initialStateTimeoutMs });
}

export { expect };
