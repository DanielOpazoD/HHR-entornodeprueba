import { test, expect } from '@playwright/test';
import { bootstrapSeededRecord, buildLegacyE2ERecord, ensureAuthenticated } from './fixtures/auth';
import { waitForPersistedBedFields } from './fixtures/censusPersistence';
import { installDailyRecordAuthorityRoute } from './fixtures/dailyRecordAuthorityRoute';

const LEGACY_DATE = process.env.E2E_FIXED_DATE ?? new Date().toISOString().slice(0, 10);

test.describe('Legacy Firebase compatibility', () => {
  test('opens a legacy record, normalizes it, and keeps the day editable', async ({ page }) => {
    const record = buildLegacyE2ERecord(LEGACY_DATE);
    const authority = await installDailyRecordAuthorityRoute(page, record);
    await bootstrapSeededRecord(page, {
      role: 'editor',
      forceLocalOnlySync: false,
      seedRemoteAuthority: true,
      forceAuthorityCallable: true,
      date: LEGACY_DATE,
      record,
      useRuntimeOverride: false,
    });

    await page.goto(`/censo?date=${LEGACY_DATE}`);
    await ensureAuthenticated(page);
    await page.goto(`/censo?date=${LEGACY_DATE}`);

    await expect(page.getByTestId('census-table')).toBeVisible({ timeout: 20_000 });

    const legacyRow = page.locator('[data-testid="patient-row"][data-bed-id="R1"]').first();
    const extraBedRow = page.locator('[data-testid="patient-row"][data-bed-id="E1"]').first();
    const patientNameInput = legacyRow.locator('input[name="patientName"]').first();
    const demographicsButton = legacyRow.getByRole('button', { name: /Datos del Paciente/i });

    await expect(patientNameInput).toHaveValue('LEGACY PATIENT');
    await expect(extraBedRow).toBeVisible();

    await demographicsButton.click();
    const demographicsDialog = page.getByRole('dialog', { name: 'Datos Demográficos' });
    await expect(demographicsDialog).toBeVisible();
    const firstNameInput = demographicsDialog.getByPlaceholder('Nombre', { exact: true });
    const lastNameInput = demographicsDialog.getByPlaceholder('Apellido paterno', { exact: true });
    const secondLastNameInput = demographicsDialog.getByPlaceholder('Apellido materno', {
      exact: true,
    });

    await firstNameInput.fill('Legacy');
    await expect(firstNameInput).toHaveValue('Legacy');
    await lastNameInput.fill('Patient');
    await expect(lastNameInput).toHaveValue('Patient');
    await secondLastNameInput.fill('Normalized');
    await expect(secondLastNameInput).toHaveValue('Normalized');
    await demographicsDialog.getByRole('button', { name: /Guardar Cambios/i }).click();
    await expect(demographicsDialog).toBeHidden();
    const demographicsSave = await authority.nextCall();
    expect(demographicsSave.payload.date).toBe(LEGACY_DATE);
    expect(demographicsSave.payload.patch).toMatchObject({
      'beds.R1.patientName': 'Legacy Patient Normalized',
    });
    await demographicsSave.succeed();

    await expect(patientNameInput).toHaveValue('Legacy Patient Normalized');
    await waitForPersistedBedFields({
      page,
      date: LEGACY_DATE,
      bedId: 'R1',
      expected: {
        patientName: 'Legacy Patient Normalized',
        firstName: 'Legacy',
        lastName: 'Patient',
        secondLastName: 'Normalized',
        pathology: 'LEGACY DX',
      },
    });

    await page.reload();
    await page.goto(`/censo?date=${LEGACY_DATE}`);
    await expect(page.getByTestId('census-table')).toBeVisible({ timeout: 20_000 });
    await expect(legacyRow.locator('input[name="patientName"]').first()).toHaveValue(
      'Legacy Patient Normalized'
    );
    await expect(extraBedRow).toBeVisible();
  });
});
