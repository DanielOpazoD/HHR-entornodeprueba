import { expect, test, type Browser, type Page } from '@playwright/test';

import {
  bootstrapSeededRecord,
  buildCanonicalE2ERecord,
  ensureAuthenticated,
} from './fixtures/auth';

const MOVEMENT_DATE = process.env.E2E_FIXED_DATE ?? '2026-02-20';
const SOURCE_BED = 'R1';
const PATIENT_NAME = 'Cma Role Sync Patient';
const PATIENT_DIAGNOSIS = 'CMA role sync diagnosis';

const getPatientRow = (page: Page, bedId: string) =>
  page.locator(`[data-testid="patient-row"][data-bed-id="${bedId}"]`).first();

const expectSourceBedCleared = async (page: Page) => {
  const row = getPatientRow(page, SOURCE_BED);

  await expect(row.locator('input[name="patientName"]')).toHaveCount(0);
};

const buildMovementRecord = (date: string) => {
  const canonical = buildCanonicalE2ERecord(date);
  const beds = canonical.beds as Record<string, Record<string, unknown>>;

  return buildCanonicalE2ERecord(date, {
    beds: {
      ...beds,
      [SOURCE_BED]: {
        ...beds[SOURCE_BED],
        patientName: PATIENT_NAME,
        rut: '22.222.222-2',
        pathology: PATIENT_DIAGNOSIS,
        specialty: 'Medicina',
        status: 'Estable',
        age: '52',
        admissionDate: date,
      },
    },
  });
};

const openMovementCensus = async (
  page: Page,
  role: 'admin' | 'editor',
  record: Record<string, unknown>
) => {
  await bootstrapSeededRecord(page, {
    role,
    date: MOVEMENT_DATE,
    record,
    useRuntimeOverride: true,
    forceEditableRecord: true,
  });
  await page.goto(`/censo?date=${MOVEMENT_DATE}`);
  await ensureAuthenticated(page);
  await expect(page.getByTestId('census-table')).toBeVisible({ timeout: 20_000 });
};

const readPersistedRecord = async (page: Page): Promise<Record<string, unknown>> =>
  page.evaluate(date => {
    const records = JSON.parse(localStorage.getItem('hanga_roa_hospital_data') || '{}') as Record<
      string,
      Record<string, unknown>
    >;

    return records[date];
  }, MOVEMENT_DATE);

const createPage = async (browser: Browser) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  return { context, page };
};

test.describe('Movement role sync smoke', () => {
  test('nurse CMA egress is consumed by admin without duplicating the source bed', async ({
    browser,
  }) => {
    test.setTimeout(60_000);
    const nurseSession = await createPage(browser);
    const adminSession = await createPage(browser);

    try {
      await openMovementCensus(nurseSession.page, 'editor', buildMovementRecord(MOVEMENT_DATE));

      const nurseRow = getPatientRow(nurseSession.page, SOURCE_BED);
      await expect(nurseRow.locator('input[name="patientName"]').first()).toHaveValue(PATIENT_NAME);

      const actionsButton = nurseRow.locator('button[title="Acciones"]').first();
      await expect(actionsButton).toBeVisible({ timeout: 10_000 });
      await actionsButton.evaluate(element => (element as HTMLButtonElement).click());

      await nurseSession.page.getByText('Egreso CMA', { exact: true }).click();
      await expect(nurseSession.page.getByRole('dialog')).toContainText(PATIENT_NAME);
      await nurseSession.page.getByRole('button', { name: 'Confirmar' }).click();

      await expectSourceBedCleared(nurseSession.page);
      await expect(nurseSession.page.getByText(PATIENT_NAME).first()).toBeVisible({
        timeout: 10_000,
      });

      const persistedAfterNurseMovement = await readPersistedRecord(nurseSession.page);
      const persistedBeds = persistedAfterNurseMovement.beds as Record<
        string,
        Record<string, unknown>
      >;
      const persistedCma = persistedAfterNurseMovement.cma as Array<Record<string, unknown>>;
      expect(persistedBeds[SOURCE_BED]?.patientName || '').toBe('');
      expect(persistedCma).toHaveLength(1);
      expect(persistedCma[0]).toMatchObject({
        originalBedId: SOURCE_BED,
        patientName: PATIENT_NAME,
        diagnosis: PATIENT_DIAGNOSIS,
      });

      await openMovementCensus(adminSession.page, 'admin', persistedAfterNurseMovement);

      await expectSourceBedCleared(adminSession.page);
      await expect(adminSession.page.getByText(PATIENT_NAME).first()).toBeVisible({
        timeout: 10_000,
      });
      await expect(adminSession.page.getByText(PATIENT_DIAGNOSIS).first()).toBeVisible();
    } finally {
      await nurseSession.context.close();
      await adminSession.context.close();
    }
  });
});
