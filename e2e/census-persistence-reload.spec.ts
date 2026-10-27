import { test, expect } from '@playwright/test';
import {
  bootstrapSeededRecord,
  buildCanonicalE2ERecord,
  ensureAuthenticated,
} from './fixtures/auth';
import {
  expectClinicalDiagnosis,
  getClinicalDiagnosisButton,
} from './fixtures/clinicalBlockEditor';
import { waitForPersistedBedFields } from './fixtures/censusPersistence';
import { installDailyRecordAuthorityRoute } from './fixtures/dailyRecordAuthorityRoute';
import { DataFactory } from '../src/tests/factories/DataFactory';
import { getTodayISO } from '../src/utils/dateCoreUtils';

const PERSISTENCE_DATE = process.env.E2E_FIXED_DATE ?? getTodayISO();

const getRow = (page: import('@playwright/test').Page, bedId: string) =>
  page.locator(`[data-testid="patient-row"][data-bed-id="${bedId}"]`).first();

test.describe('Census persistence and reload', () => {
  test('keeps the selected historical day and its record across handoff reloads and day changes', async ({
    page,
  }) => {
    const firstDate = '2026-02-20';
    const secondDate = '2026-02-21';
    const buildRecord = (date: string, name: string) => {
      const record = DataFactory.createMockDailyRecord(date);
      return {
        ...record,
        beds: {
          ...record.beds,
          R1: DataFactory.createMockPatient('R1', {
            patientName: name,
            rut: date === firstDate ? '12345678-5' : '11111111-1',
            clinicalEpisodeId: `synthetic-date-${date}`,
            admissionDate: date,
          }),
        },
      };
    };
    const first = buildRecord(firstDate, 'PACIENTE SINTETICO DIA 20');
    const second = buildRecord(secondDate, 'PACIENTE SINTETICO DIA 21');
    await bootstrapSeededRecord(page, {
      role: 'admin',
      date: firstDate,
      record: first,
      useRuntimeOverride: false,
      forceEditableRecord: true,
      forceLocalOnlySync: true,
    });
    await page.evaluate(async record => {
      const cached = JSON.parse(localStorage.getItem('hanga_roa_hospital_data') ?? '{}');
      cached[record.date] = record;
      localStorage.setItem('hanga_roa_hospital_data', JSON.stringify(cached));
      const request = indexedDB.open('HangaRoaDB');
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      try {
        const tx = db.transaction('dailyRecords', 'readwrite');
        tx.objectStore('dailyRecords').put(record);
        await new Promise<void>((resolve, reject) => {
          tx.oncomplete = () => resolve();
          tx.onabort = tx.onerror = () => reject(tx.error);
        });
      } finally {
        db.close();
      }
    }, second);
    await page.goto(`/medical-handoff?date=${firstDate}`);
    await expect(
      page.getByText('PACIENTE SINTETICO DIA 20', { exact: true }).first()
    ).toBeVisible();
    await expect(page).toHaveURL(`/medical-handoff?date=${firstDate}`);
    await page.reload();
    await expect(
      page.getByText('PACIENTE SINTETICO DIA 20', { exact: true }).first()
    ).toBeVisible();
    await page.getByRole('button', { name: /21 de febrero de 2026/ }).click();
    await expect(page).toHaveURL(`/medical-handoff?date=${secondDate}`);
    await expect(
      page.getByText('PACIENTE SINTETICO DIA 21', { exact: true }).first()
    ).toBeVisible();
    await page.reload();
    await expect(
      page.getByText('PACIENTE SINTETICO DIA 21', { exact: true }).first()
    ).toBeVisible();
    await page.getByRole('button', { name: 'Entrega Turno Enfermería', exact: true }).click();
    await expect(page).toHaveURL(`/nursing-handoff?date=${secondDate}`);
    await page.reload();
    await expect(
      page.getByText('PACIENTE SINTETICO DIA 21', { exact: true }).first()
    ).toBeVisible();
    await page.getByRole('button', { name: 'Censo Diario', exact: true }).click();
    await expect(page).toHaveURL(`/census?date=${secondDate}`);
    await expect(getRow(page, 'R1').locator('input[name="patientName"]')).toHaveValue(
      'PACIENTE SINTETICO DIA 21'
    );
  });

  test('keeps patient edits after save and page reload', async ({ page }) => {
    const baseRecord = buildCanonicalE2ERecord(PERSISTENCE_DATE);
    const beds = (baseRecord.beds as Record<string, Record<string, unknown>>) || {};

    beds.R1 = {
      ...beds.R1,
      patientName: 'INITIAL PATIENT',
      // A stable identity makes this a demographic correction, not a patient replacement.
      rut: '12345678-5',
      clinicalEpisodeId: 'e2e-persistence-episode',
      pathology: 'INITIAL DX',
      status: 'Estable',
      age: '39',
      admissionDate: PERSISTENCE_DATE,
      // Keep the mocked authority snapshot canonical when the admission time is unknown.
      admissionTime: '',
    };

    const record = { ...baseRecord, beds };
    const authority = await installDailyRecordAuthorityRoute(page, record);
    await bootstrapSeededRecord(page, {
      role: 'editor',
      forceLocalOnlySync: false,
      seedRemoteAuthority: true,
      forceAuthorityCallable: true,
      date: PERSISTENCE_DATE,
      record,
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
    const demographicsSave = await authority.nextCall();
    expect(demographicsSave.payload.date).toBe(PERSISTENCE_DATE);
    expect(demographicsSave.payload.patch).toMatchObject({
      'beds.R1.patientName': 'Updated Patient',
    });
    await demographicsSave.succeed();
    await waitForPersistedBedFields({
      page,
      date: PERSISTENCE_DATE,
      bedId: 'R1',
      expected: {
        patientName: 'Updated Patient',
        pathology: 'INITIAL DX',
        clinicalEpisodeId: 'e2e-persistence-episode',
        admissionTime: '',
      },
    });

    const patientNameInput = row.locator('input[name="patientName"]').first();
    await expect(patientNameInput).toHaveValue('Updated Patient');
    await getClinicalDiagnosisButton(row).click();
    await page.getByTestId('clinical-block-pathology-R1').fill('UPDATED DX');
    await page.getByTestId('clinical-block-save-R1').click();
    const diagnosisSave = await authority.nextCall();
    expect(diagnosisSave.payload.date).toBe(PERSISTENCE_DATE);
    expect(diagnosisSave.payload.patch).toMatchObject({ 'beds.R1.pathology': 'UPDATED DX' });
    // The editor stays open until the controlled authority response confirms the write.
    await expect(page.getByTestId('clinical-block-editor-R1')).toBeVisible();
    await diagnosisSave.succeed();
    await expect(page.getByTestId('clinical-block-editor-R1')).toBeHidden();

    await expectClinicalDiagnosis(row, 'UPDATED DX');
    await waitForPersistedBedFields({
      page,
      date: PERSISTENCE_DATE,
      bedId: 'R1',
      expected: {
        patientName: 'Updated Patient',
        firstName: 'Updated',
        lastName: 'Patient',
        secondLastName: '',
        admissionTime: '',
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
