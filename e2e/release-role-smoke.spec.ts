import { expect, test, type Page } from '@playwright/test';

const BED_IDS = [
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

type SmokeUser = {
  uid: string;
  email: string;
  displayName: string;
  role: 'admin' | 'nurse_hospital' | 'doctor_specialist';
};

const formatLocalIsoDate = (date: Date): string =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate()
  ).padStart(2, '0')}`;

const resolveCurrentSmokeClinicalDay = (now: Date = new Date()): string => {
  const clinicalDate = new Date(now);
  if (clinicalDate.getHours() < 8) {
    clinicalDate.setDate(clinicalDate.getDate() - 1);
  }
  return formatLocalIsoDate(clinicalDate);
};

const buildRoleSmokeRecord = (date: string) => {
  const beds = Object.fromEntries(
    BED_IDS.map(id => [
      id,
      {
        id,
        bedId: id,
        patientName: '',
        rut: '',
        isBlocked: false,
        bedMode: 'adult',
        hasCompanionCrib: false,
        devices: [],
        status: '',
        pathology: '',
        specialty: '',
        age: '',
        admissionDate: date,
        hasWristband: false,
        surgicalComplication: false,
        isUPC: false,
      },
    ])
  );

  beds.R1 = {
    ...beds.R1,
    patientName: 'Paciente Smoke Roles',
    rut: '11.111.111-1',
    pathology: 'Diagnostico smoke',
    specialty: 'Medicina',
    status: 'Estable',
    age: '45',
  };

  return {
    date,
    beds,
    discharges: [],
    transfers: [],
    cma: [],
    lastUpdated: `${date}T12:00:00.000Z`,
    nurses: ['Enf. Smoke', 'Dr. Smoke'],
    nursesDayShift: ['Enf. Smoke'],
    nursesNightShift: ['Enf. Noche'],
    tensDayShift: ['TENS Smoke'],
    tensNightShift: ['TENS Noche'],
    handoffNightReceives: ['Enf. Noche'],
    activeExtraBeds: [],
    schemaVersion: 1,
  };
};

const bootstrapRoleSmoke = async (page: Page, user: SmokeUser, date: string) => {
  const record = buildRoleSmokeRecord(date);

  await page.addInitScript(
    ({ smokeUser, smokeDate, smokeRecord }) => {
      const runtimeWindow = window as Window & {
        __HHR_E2E_OVERRIDE__?: Record<string, unknown>;
      };
      runtimeWindow.__HHR_E2E_OVERRIDE__ = { [smokeDate]: smokeRecord };
      localStorage.setItem('hhr_e2e_bootstrap_user', JSON.stringify(smokeUser));
      localStorage.setItem('hhr_e2e_force_local_only_sync', 'true');
      localStorage.setItem('hhr_e2e_force_editable_record', 'true');
      localStorage.setItem('hhr_db_initialized', 'true');
    },
    { smokeUser: user, smokeDate: date, smokeRecord: record }
  );

  await page.goto(`/censo?date=${date}`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('authenticated-user-menu-button')).toBeVisible({
    timeout: 20000,
  });
  await expect(page.getByTestId('census-table')).toBeVisible({ timeout: 20000 });
};

test.describe('Release role smoke', () => {
  test('admin can reach census, transfer management, and medical handoff', async ({ page }) => {
    const date = resolveCurrentSmokeClinicalDay();
    await bootstrapRoleSmoke(
      page,
      {
        uid: 'smoke-admin',
        email: 'daniel.opazo@hospitalhangaroa.cl',
        displayName: 'Smoke Admin',
        role: 'admin',
      },
      date
    );

    await page.getByTestId('nav-tab-transfer-management').click();
    await expect(page).toHaveURL(/\/transfer-management/, { timeout: 20000 });
    await expect(page.getByTestId('transfer-management-view')).toBeVisible({ timeout: 20000 });

    await page.getByTestId('nav-tab-medical-handoff').click();
    await expect(page).toHaveURL(/\/medical-handoff/, { timeout: 20000 });
    await expect(page.getByTestId('medical-handoff-create-entry-button').first()).toBeVisible({
      timeout: 20000,
    });
  });

  test('hospital nurse can reach census, nursing handoff, and transfer management', async ({
    page,
  }) => {
    const date = resolveCurrentSmokeClinicalDay();
    await bootstrapRoleSmoke(
      page,
      {
        uid: 'smoke-nurse',
        email: 'hospitalizados@hospitalhangaroa.cl',
        displayName: 'Smoke Nurse',
        role: 'nurse_hospital',
      },
      date
    );

    await page.getByTestId('nav-tab-nursing-handoff').click();
    await expect(page).toHaveURL(/\/nursing-handoff/, { timeout: 20000 });
    await expect(page.getByTestId('handoff-shift-day-button')).toBeVisible({
      timeout: 20000,
    });

    await page.getByTestId('nav-tab-transfer-management').click();
    await expect(page).toHaveURL(/\/transfer-management/, { timeout: 20000 });
    await expect(page.getByTestId('transfer-management-view')).toBeVisible({ timeout: 20000 });
  });

  test('specialist has restricted census and can reach editable medical handoff today', async ({
    page,
  }) => {
    const date = resolveCurrentSmokeClinicalDay();
    await bootstrapRoleSmoke(
      page,
      {
        uid: 'smoke-specialist',
        email: 'especialista@hospitalhangaroa.cl',
        displayName: 'Smoke Specialist',
        role: 'doctor_specialist',
      },
      date
    );

    await expect(page.getByTestId('nav-tab-transfer-management')).toHaveCount(0);
    await page.getByTestId('nav-tab-medical-handoff').click();
    await expect(page).toHaveURL(/\/medical-handoff/, { timeout: 20000 });
    await expect(page.getByTestId('medical-handoff-create-entry-button').first()).toBeVisible({
      timeout: 20000,
    });
  });
});
