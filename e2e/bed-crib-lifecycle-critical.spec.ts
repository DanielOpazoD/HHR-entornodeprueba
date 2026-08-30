import { expect, test, type Page } from '@playwright/test';
import {
  bootstrapSeededRecord,
  buildCanonicalE2ERecord,
  ensureAuthenticated,
} from './fixtures/auth';
import { installDailyRecordAuthorityRoute } from './fixtures/dailyRecordAuthorityRoute';

const E2E_DATE = process.env.E2E_FIXED_DATE ?? '2026-02-20';
const PARENT_EPISODE_ID = 'e2e-parent-episode';
const CRIB_EPISODE_ID = 'e2e-crib-episode';

const buildParentPatient = () => ({
  id: 'R1',
  bedId: 'R1',
  patientName: 'Paciente Ciclo Cuna',
  firstName: 'Paciente',
  lastName: 'Ciclo',
  secondLastName: 'Cuna',
  rut: '11.111.111-1',
  clinicalEpisodeId: PARENT_EPISODE_ID,
  firstSeenDate: E2E_DATE,
  admissionDate: E2E_DATE,
  admissionTime: '08:00',
  isBlocked: false,
  bedMode: 'Cama',
  hasCompanionCrib: false,
  devices: [],
  status: 'Estable',
  pathology: 'Diagnóstico E2E',
  specialty: 'Medicina',
  age: '37',
  hasWristband: true,
  surgicalComplication: false,
  isUPC: false,
});

const buildClinicalCrib = () => ({
  id: 'R1',
  bedId: 'R1',
  patientName: 'RN Paciente Ciclo Cuna',
  firstName: 'RN',
  lastName: 'Paciente',
  secondLastName: '',
  rut: '',
  identityStatus: 'provisional',
  clinicalEpisodeId: CRIB_EPISODE_ID,
  firstSeenDate: E2E_DATE,
  admissionDate: E2E_DATE,
  admissionTime: '08:30',
  isBlocked: false,
  bedMode: 'Cuna',
  hasCompanionCrib: false,
  devices: [],
  status: 'Estable',
  pathology: '',
  specialty: 'Pediatría',
  age: '0',
  hasWristband: false,
  surgicalComplication: false,
  isUPC: false,
});

const buildRecord = (withCrib = false) => {
  const record = buildCanonicalE2ERecord(E2E_DATE);
  const beds = record.beds as Record<string, Record<string, unknown>>;
  Object.values(beds).forEach(bed => {
    bed.bedMode = 'Cama';
  });
  beds.R1 = {
    ...beds.R1,
    ...buildParentPatient(),
    ...(withCrib ? { clinicalCrib: buildClinicalCrib() } : {}),
  };
  return { ...record, beds };
};

const getParentRow = (page: Page) =>
  page.locator('[data-testid="patient-row"][data-bed-id="R1"]').first();

const getCribRow = (page: Page) =>
  page
    .locator('tr[data-testid="patient-row"]')
    .filter({ hasText: /\bCUNA\b/ })
    .first();

const openCensus = async (page: Page, record: Record<string, unknown>) => {
  const authority = await installDailyRecordAuthorityRoute(page, record);
  await bootstrapSeededRecord(page, {
    role: 'admin',
    date: E2E_DATE,
    record,
    useRuntimeOverride: true,
    forceEditableRecord: true,
    forceLocalOnlySync: false,
    seedRemoteAuthority: true,
    forceAuthorityCallable: true,
  });
  await page.goto(`/censo?date=${E2E_DATE}`);
  await ensureAuthenticated(page);
  await page.goto(`/censo?date=${E2E_DATE}`);
  await expect(page.getByTestId('census-table')).toBeVisible({ timeout: 20_000 });
  await expect(getParentRow(page)).toBeVisible();
  return authority;
};

const confirmClear = async (page: Page, row: ReturnType<typeof getParentRow>) => {
  await row.getByTitle('Acciones').click({ force: true });
  await page.getByTitle('Borrar datos').click({ force: true });
  await expect(page.getByText(/Limpiar (cama|cuna)/i).last()).toBeVisible();
  await page.getByRole('button', { name: 'Sí, limpiar' }).click();
};

test.describe('Critical bed and attached-crib lifecycle', () => {
  test('rolls back a crib clear rejected after its single guarded retry', async ({ page }) => {
    test.setTimeout(60_000);
    const authority = await openCensus(page, buildRecord(true));
    await expect(getCribRow(page)).toBeVisible();

    await confirmClear(page, getCribRow(page));
    await expect(getCribRow(page)).toHaveCount(0, { timeout: 2_000 });
    const rejectedClear = await authority.nextCall();
    expect(rejectedClear.payload.intentionalBedClear).toMatchObject({
      bedId: 'R1',
      target: 'clinicalCrib',
    });
    await rejectedClear.reject({
      status: 'FAILED_PRECONDITION',
      httpStatus: 400,
      message: 'E2E authority rejected the stale guarded mutation.',
    });

    const rejectedRetry = await authority.nextCall();
    expect(rejectedRetry.payload.intentionalBedClear).toMatchObject({
      bedId: 'R1',
      target: 'clinicalCrib',
    });
    await rejectedRetry.reject({
      status: 'FAILED_PRECONDITION',
      httpStatus: 400,
      message: 'E2E authority rejected the guarded retry.',
    });

    // Exhausting the bounded retry restores exactly the visible crib.
    await expect(getCribRow(page)).toBeVisible({ timeout: 10_000 });
    await expect(getCribRow(page).locator('input[name="patientName"]')).toHaveValue(
      'RN Paciente Ciclo Cuna'
    );
  });

  test('persists a confirmed crib clear after reloading the census', async ({ page }) => {
    test.setTimeout(60_000);
    const authority = await openCensus(page, buildRecord(true));
    await expect(getCribRow(page)).toBeVisible();

    await confirmClear(page, getCribRow(page));
    await expect(getCribRow(page)).toHaveCount(0, { timeout: 2_000 });
    const confirmedClear = await authority.nextCall();
    expect(confirmedClear.payload.intentionalBedClear).toMatchObject({
      bedId: 'R1',
      target: 'clinicalCrib',
    });
    await confirmedClear.succeed();

    await page.reload();
    await expect(getParentRow(page)).toBeVisible({ timeout: 15_000 });
    await expect(getCribRow(page)).toHaveCount(0);
  });

  test('clears an occupied bed and its attached crib as one optimistic, confirmed command', async ({
    page,
  }) => {
    test.setTimeout(60_000);
    const authority = await openCensus(page, buildRecord(true));
    await expect(getCribRow(page)).toBeVisible();

    await confirmClear(page, getParentRow(page));

    // Both occupied rows disappear before the authority response is released.
    await expect(getParentRow(page)).toHaveCount(0, { timeout: 2_000 });
    await expect(getCribRow(page)).toHaveCount(0, { timeout: 2_000 });
    await expect(page.getByRole('status', { name: 'Guardando limpieza de la cama' })).toBeVisible();

    const clearCall = await authority.nextCall();
    expect(clearCall.payload.intentionalBedClear).toMatchObject({
      bedId: 'R1',
      confirmedAssociatedCrib: {
        clinicalEpisodeId: CRIB_EPISODE_ID,
      },
    });
    expect(clearCall.payload.intentionalBedClear?.target).toBeUndefined();
    expect(clearCall.payload.patch['beds.R1']).toMatchObject({
      patientName: '',
    });
    await clearCall.succeed();

    await page.reload();
    await expect(getParentRow(page)).toHaveCount(0);
    await expect(getCribRow(page)).toHaveCount(0);
  });
});
