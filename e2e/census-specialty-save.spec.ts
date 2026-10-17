import { expect, test, type Locator, type Page } from '@playwright/test';
import {
  bootstrapSeededRecord,
  buildCanonicalE2ERecord,
  ensureAuthenticated,
} from './fixtures/auth';
import { installDailyRecordAuthorityRoute } from './fixtures/dailyRecordAuthorityRoute';
import { createSpecialtyAuthority } from './fixtures/specialtyAuthority';

const E2E_DATE = process.env.E2E_FIXED_DATE ?? '2026-02-20';
const SAVE_ERROR = 'No se pudo confirmar el cambio. Revisa el dato e inténtalo de nuevo.';
let server: Awaited<ReturnType<typeof createSpecialtyAuthority>>;

const buildRecord = () => {
  const record = buildCanonicalE2ERecord(E2E_DATE);
  record.meta = { revision: 1 };
  const beds = record.beds as Record<string, Record<string, unknown>>;
  // Empty beds must not carry an admission and become synthetic duplicate episodes.
  Object.values(beds).forEach(bed => {
    bed.admissionDate = '';
  });
  for (const bedId of ['R1', 'R2']) {
    beds[bedId] = {
      ...beds[bedId],
      patientName: `Paciente Sintético ${bedId}`,
      rut: bedId === 'R1' ? '11.111.111-1' : '22.222.222-2',
      clinicalEpisodeId: `e2e-specialty-${bedId}`,
      firstSeenDate: E2E_DATE,
      admissionDate: E2E_DATE,
      admissionTime: '08:00',
      status: 'Estable',
      pathology: 'Diagnóstico de prueba',
      specialty: 'Medicina',
      age: '37',
    };
  }
  return record;
};

const getRow = (page: Page, bedId: string) =>
  page.locator(`[data-testid="patient-row"][data-bed-id="${bedId}"]`).first();

const getSpecialtyButton = (row: Locator, specialty: string) =>
  row.getByTitle(`Especialidad: ${specialty}`, { exact: true });

const readLocalSpecialties = (page: Page) =>
  page.evaluate(date => {
    const records = JSON.parse(localStorage.getItem('hanga_roa_hospital_data') || '{}') as Record<
      string,
      { beds?: Record<string, { specialty?: string }> }
    >;
    return ['R1', 'R2'].map(bedId => records[date]?.beds?.[bedId]?.specialty);
  }, E2E_DATE);

const openCensus = async (page: Page) => {
  const browserErrors: string[] = [];
  page.on('pageerror', error => browserErrors.push(error.message));
  const record = buildRecord();
  await server.authorizeBrowser(page);
  await server.seed(record);
  const authority = await installDailyRecordAuthorityRoute(page, record, server.commit);
  // Exercise the protected, episode-bound route without changing deployment flags
  // or contacting a real Firebase project. The fixture only releases UI requests.
  await page.addInitScript(() => {
    localStorage.setItem(
      'hhr_feature_flags',
      JSON.stringify({ SPECIALTY_EPISODE_ASSIGNMENT: true })
    );
  });
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
  await expect(getRow(page, 'R1')).toBeVisible();
  await expect(getRow(page, 'R2')).toBeVisible();
  return { authority, browserErrors };
};

const selectSpecialty = async (
  page: Page,
  row: Locator,
  current: string,
  next: string,
  keyboard = false
) => {
  const dialog = page.getByRole('dialog', { name: 'Asignar especialidad', exact: true });
  if (await dialog.isVisible()) {
    await dialog.getByRole('button', { name: 'Cerrar selector de especialidad' }).click();
  }
  const anchor = getSpecialtyButton(row, current);
  if (keyboard) {
    await anchor.focus();
    await anchor.press('Enter');
  } else {
    await anchor.click();
  }
  await expect(dialog).toBeVisible();
  const option = dialog.getByRole('button', { name: next, exact: true });
  if (keyboard) {
    await option.focus();
    await option.press('Enter');
  } else {
    await option.click();
  }
};

test.describe('Confirmed specialty saves', () => {
  test.describe.configure({ mode: 'serial' });
  test.beforeAll(async () => {
    server = await createSpecialtyAuthority();
  });
  test.afterAll(async () => {
    await server?.cleanup();
  });
  test('queues different beds, keeps each choice pending, and survives a real reload', async ({
    page,
  }) => {
    const { authority, browserErrors } = await openCensus(page);
    const firstRow = getRow(page, 'R1');
    const secondRow = getRow(page, 'R2');

    await selectSpecialty(page, firstRow, 'Medicina', 'Cirugía', true);
    const firstCall = await authority.nextCall();
    expect(firstCall.payload.syncContract?.baseRevision).toBe(1);
    expect(firstCall.payload.patch).toEqual({ 'beds.R1.specialty': 'Cirugía' });
    expect(firstCall.payload).toMatchObject({
      specialtyIntent: {
        kind: 'manual',
        bedId: 'R1',
        target: 'bed',
        episodeId: 'e2e-specialty-R1',
        value: 'Cirugía',
      },
    });
    await expect(
      page.getByRole('status').filter({ hasText: 'Guardando especialidad' })
    ).toBeVisible();
    await expect(getSpecialtyButton(firstRow, 'Medicina')).toBeDisabled();
    await expect(getSpecialtyButton(secondRow, 'Medicina')).toBeEnabled();
    expect(await readLocalSpecialties(page)).toEqual(['Medicina', 'Medicina']);

    await selectSpecialty(page, secondRow, 'Medicina', 'Traumatología');
    await expect(getSpecialtyButton(secondRow, 'Medicina')).toBeDisabled();
    expect(authority.queuedCallCount()).toBe(0);

    await firstCall.succeed();
    const secondCall = await authority.nextCall();
    expect(secondCall.payload.syncContract?.baseRevision).toBe(2);
    expect(secondCall.payload.patch).toEqual({ 'beds.R2.specialty': 'Traumatología' });
    await expect(getSpecialtyButton(firstRow, 'Cirugía')).toBeEnabled();
    await expect.poll(() => readLocalSpecialties(page)).toEqual(['Cirugía', 'Medicina']);

    await secondCall.succeed();
    await expect(getSpecialtyButton(secondRow, 'Traumatología')).toBeEnabled();
    // Releasing HTTP alone is not proof of durable browser persistence.
    await expect.poll(() => readLocalSpecialties(page)).toEqual(['Cirugía', 'Traumatología']);
    const remote = await server.read(E2E_DATE);
    expect(remote?.meta.revision).toBe(3);
    for (const [bedId, value, call] of [
      ['R1', 'Cirugía', firstCall],
      ['R2', 'Traumatología', secondCall],
    ] as const) {
      expect(remote?.beds[bedId]).toMatchObject({
        specialty: value,
        specialtyAssignment: {
          source: 'manual',
          episodeId: `e2e-specialty-${bedId}`,
          decisionId: call.payload.syncContract?.mutationId,
        },
      });
    }
    await page.reload();
    await expect(getSpecialtyButton(getRow(page, 'R1'), 'Cirugía')).toBeVisible();
    await expect(getSpecialtyButton(getRow(page, 'R2'), 'Traumatología')).toBeVisible();
    expect(browserErrors).toEqual([]);
  });

  test('shows a rejected choice on a narrow screen and allows a confirmed retry', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const { authority, browserErrors } = await openCensus(page);
    const row = getRow(page, 'R1');
    await selectSpecialty(page, row, 'Medicina', 'Cirugía', true);
    const rejectedCall = await authority.nextCall();
    expect(rejectedCall.payload.patch).toEqual({ 'beds.R1.specialty': 'Cirugía' });
    expect(await readLocalSpecialties(page)).toEqual(['Medicina', 'Medicina']);
    await rejectedCall.reject();

    await expect(page.getByRole('alert').filter({ hasText: SAVE_ERROR })).toBeVisible();
    expect((await server.read(E2E_DATE))?.beds.R1.specialty).toBe('Medicina');
    await expect(getSpecialtyButton(row, 'Medicina')).toBeEnabled();
    expect(await readLocalSpecialties(page)).toEqual(['Medicina', 'Medicina']);

    await selectSpecialty(page, row, 'Medicina', 'Cirugía');
    const retryCall = await authority.nextCall();
    expect(retryCall.payload.patch).toEqual({ 'beds.R1.specialty': 'Cirugía' });
    await retryCall.succeed();
    await expect.poll(() => readLocalSpecialties(page)).toEqual(['Cirugía', 'Medicina']);
    await expect(getSpecialtyButton(row, 'Cirugía')).toBeEnabled();
    expect((await server.read(E2E_DATE))?.beds.R1).toMatchObject({
      specialty: 'Cirugía',
      specialtyAssignment: {
        source: 'manual',
        decisionId: retryCall.payload.syncContract?.mutationId,
      },
    });
    await expect(page.getByRole('alert').filter({ hasText: SAVE_ERROR })).toHaveCount(0);
    expect(browserErrors).toEqual([]);
  });
});
