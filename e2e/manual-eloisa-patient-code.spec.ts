import { createHash } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import {
  bootstrapSeededRecord,
  buildCanonicalE2ERecord,
  ensureAuthenticated,
} from './fixtures/auth';
import { waitForPersistedBedFields } from './fixtures/censusPersistence';

const TARGET_BED = 'R1';
const ENCOUNTER_ID = '99887766';
const TEST_RUT = '11.111.111-1';
const TEST_NAME = 'Ana María Pérez Soto';

const canonicalize = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== 'object') return value;
  return Object.keys(value as Record<string, unknown>)
    .sort()
    .reduce<Record<string, unknown>>((result, key) => {
      result[key] = canonicalize((value as Record<string, unknown>)[key]);
      return result;
    }, {});
};

const buildPatientCode = (date: string): string => {
  const payload = canonicalize({
    admissionDate: date,
    admissionTime: '08:15',
    biologicalSex: 'Femenino',
    birthDate: '1986-05-12',
    capturedAt: new Date().toISOString(),
    devices: ['CVC', 'Sonda Foley'],
    deviceEntries: [
      { name: 'CVC', installationDatetime: `${date}T07:15:00-06:00` },
      { name: 'Sonda Foley', installationDatetime: `${date}T07:30:00-06:00` },
    ],
    diagnosis: 'Diagnóstico de prueba E2E',
    encounterId: ENCOUNTER_ID,
    encounterRoute: 'nurse',
    firstName: 'Ana',
    lastName: 'Pérez',
    middleNames: 'María',
    rut: TEST_RUT,
    secondLastName: 'Soto',
    version: 2,
  });
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const material = `HHR-PACIENTE-2.${encoded}`;
  return `${material}.${createHash('sha256').update(material).digest('base64url')}`;
};

const openEmptyCensus = async (page: Page, date: string) => {
  await bootstrapSeededRecord(page, {
    role: 'admin',
    date,
    record: buildCanonicalE2ERecord(date),
    useRuntimeOverride: true,
    forceEditableRecord: true,
  });
  await page.goto(`/censo?date=${date}`);
  await ensureAuthenticated(page);
  await expect(page.getByTestId('census-table')).toBeVisible({ timeout: 20_000 });
};

test.describe('Manual Eloísa patient code', () => {
  test('validates, previews and persists one patient through the canonical admission command', async ({
    page,
  }) => {
    const date = new Date().toISOString().slice(0, 10);
    await openEmptyCensus(page, date);

    const targetRow = page.locator('tbody tr').filter({ hasText: TARGET_BED }).first();
    await targetRow.hover();
    await targetRow.getByRole('button', { name: 'Agregar paciente' }).click();
    await page.getByRole('button', { name: 'Importar código de Eloísa' }).click();

    const modal = page.getByRole('dialog', { name: 'Importar código de Eloísa' });
    await expect(modal).toBeVisible();
    await modal.getByPlaceholder('HHR-PACIENTE-2.…').fill(buildPatientCode(date));
    await modal.getByRole('button', { name: 'Validar y revisar' }).click();

    await expect(modal.getByLabel('Vista previa del paciente')).toContainText(TEST_NAME);
    await expect(modal.getByLabel('Vista previa del paciente')).toContainText(TEST_RUT);
    await modal.getByLabel('Cama de destino').selectOption(TARGET_BED);
    await modal.getByRole('button', { name: 'Confirmar ingreso' }).click();

    await expect(modal).toBeHidden({ timeout: 20_000 });
    await waitForPersistedBedFields({
      page,
      date,
      bedId: TARGET_BED,
      expected: {
        patientName: TEST_NAME,
        rut: TEST_RUT,
        clinicalEpisodeId: ENCOUNTER_ID,
        pathology: 'Diagnóstico de prueba E2E',
      },
    });
    const structuredFields = await page.evaluate(
      ({ recordDate, bedId }) => {
        const records = JSON.parse(
          window.localStorage.getItem('hanga_roa_hospital_data') || '{}'
        ) as Record<string, { beds?: Record<string, Record<string, unknown>> }>;
        const bed = records[recordDate]?.beds?.[bedId] || {};
        return {
          deviceDetails: bed.deviceDetails,
          deviceInstanceHistory: bed.deviceInstanceHistory,
          encounterRoute: (bed.eloisaManualImportAudit as { encounterRoute?: string } | undefined)
            ?.encounterRoute,
        };
      },
      { recordDate: date, bedId: TARGET_BED }
    );
    expect(structuredFields).toMatchObject({
      deviceDetails: {
        CVC: { installationDate: date },
        CUP: { installationDate: date },
      },
      deviceInstanceHistory: expect.arrayContaining([
        expect.objectContaining({
          type: 'CVC',
          installationDate: date,
          installationTime: '07:15',
        }),
        expect.objectContaining({
          type: 'CUP',
          installationDate: date,
          installationTime: '07:30',
        }),
      ]),
      encounterRoute: 'nurse',
    });
  });
});
