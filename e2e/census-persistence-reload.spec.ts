import { test, expect } from '@playwright/test';
import {
  bootstrapSeededRecord,
  buildCanonicalE2ERecord,
  ensureAuthenticated,
} from './fixtures/auth';
import { expectClinicalDiagnosis, updateClinicalDiagnosis } from './fixtures/clinicalBlockEditor';
import { seedPersistedBedFields, waitForPersistedBedFields } from './fixtures/censusPersistence';

const PERSISTENCE_DATE = process.env.E2E_FIXED_DATE ?? new Date().toISOString().slice(0, 10);

const getRow = (page: import('@playwright/test').Page, bedId: string) =>
  page.locator(`[data-testid="patient-row"][data-bed-id="${bedId}"]`).first();

test.describe('Census persistence and reload', () => {
  test('keeps patient edits after save and page reload', async ({ page }) => {
    const baseRecord = buildCanonicalE2ERecord(PERSISTENCE_DATE);
    const beds = (baseRecord.beds as Record<string, Record<string, unknown>>) || {};

    beds.R1 = {
      ...beds.R1,
      patientName: 'INITIAL PATIENT',
      pathology: 'INITIAL DX',
      status: 'Estable',
      age: '39',
      admissionDate: PERSISTENCE_DATE,
    };

    await bootstrapSeededRecord(page, {
      role: 'editor',
      date: PERSISTENCE_DATE,
      record: { ...baseRecord, beds },
      useRuntimeOverride: true,
    });

    await page.goto(`/censo?date=${PERSISTENCE_DATE}`);
    await ensureAuthenticated(page);
    await page.goto(`/censo?date=${PERSISTENCE_DATE}`);
    await expect(page.getByTestId('census-table')).toBeVisible({ timeout: 20_000 });

    const row = getRow(page, 'R1');
    const demographicsButton = row.getByRole('button', { name: /Datos del Paciente/i });
    await demographicsButton.click();
    const demographicsDialog = page.getByRole('dialog', { name: 'Datos Demográficos' });
    await expect(demographicsDialog).toBeVisible();
    await demographicsDialog.getByPlaceholder('Nombre').fill('Updated');
    await demographicsDialog.getByPlaceholder('Apellido paterno').fill('Patient');
    await demographicsDialog.getByRole('button', { name: /Guardar Cambios/i }).click();
    await expect(demographicsDialog).toBeHidden();

    const patientNameInput = row.locator('input[name="patientName"]').first();
    await expect(patientNameInput).toHaveValue('Updated Patient');
    await updateClinicalDiagnosis(page, row, 'R1', 'UPDATED DX');

    await expectClinicalDiagnosis(row, 'UPDATED DX');
    await seedPersistedBedFields({
      page,
      date: PERSISTENCE_DATE,
      bedId: 'R1',
      fields: {
        patientName: 'Updated Patient',
        firstName: 'Updated',
        lastName: 'Patient',
        secondLastName: '',
        pathology: 'UPDATED DX',
      },
    });
    await waitForPersistedBedFields({
      page,
      date: PERSISTENCE_DATE,
      bedId: 'R1',
      expected: {
        patientName: 'Updated Patient',
        firstName: 'Updated',
        lastName: 'Patient',
        secondLastName: '',
        pathology: 'UPDATED DX',
      },
    });

    await page.reload();
    await expect(page.getByTestId('census-table')).toBeVisible({ timeout: 20_000 });
    await expect(getRow(page, 'R1')).toBeVisible();
    await expect(patientNameInput).toHaveValue('Updated Patient');
    await expectClinicalDiagnosis(row, 'UPDATED DX');
  });
});
