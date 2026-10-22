import { test, expect, type Page } from '@playwright/test';
import {
  bootstrapSeededRecord,
  buildCanonicalE2ERecord,
  ensureAuthenticated,
} from './fixtures/auth';
import { getTodayISO } from '../src/utils/dateCoreUtils';

const getTodayDate = () => getTodayISO();

const buildHospitalDayRecord = (date: string) =>
  buildCanonicalE2ERecord(date, {
    beds: {
      ...(buildCanonicalE2ERecord(date).beds as Record<string, unknown>),
      R1: {
        ...(buildCanonicalE2ERecord(date).beds as Record<string, Record<string, unknown>>).R1,
        patientName: 'Workflow Patient',
        pathology: 'Workflow DX',
        status: 'Estable',
        age: '52',
      },
    },
  });

const openHospitalDay = async (page: Page, role: 'admin' | 'viewer') => {
  const date = getTodayDate();
  await bootstrapSeededRecord(page, {
    role,
    date,
    record: buildHospitalDayRecord(date),
    useRuntimeOverride: true,
    forceEditableRecord: role !== 'viewer',
  });
  await page.goto(`/censo?date=${date}`);
  await ensureAuthenticated(page);
  await expect(page.getByTestId('census-table')).toBeVisible({ timeout: 20000 });
  return date;
};

test.describe('Complete Hospital Day E2E', () => {
  test('should complete a full hospital day workflow', async ({ page }) => {
    await openHospitalDay(page, 'admin');

    const nameInput = page.locator('input[name="patientName"]').first();
    await expect(nameInput).toBeEditable({ timeout: 10000 });
    await nameInput.fill('PACIENTE WORKFLOW');
    await expect(nameInput).toHaveValue(/paciente workflow/i);

    await page.getByRole('button', { name: 'Entrega Turno Enfermería' }).click();
    await expect(page.locator('main')).toContainText(/Enfermero\/a|Turno Largo|Turno Noche/i, {
      timeout: 15000,
    });

    await page.getByRole('button', { name: 'Entrega Turno Médicos' }).click();
    await expect(
      page
        .getByRole('button', { name: /Crear entrega médica|Generar link para firma del médico/i })
        .first()
    ).toBeVisible({
      timeout: 15000,
    });

    await page.getByRole('button', { name: 'Censo Diario' }).click();
    await expect(page.getByTestId('census-table')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('input[name="patientName"]').first()).toHaveValue(
      /paciente workflow/i
    );
  });

  test('should prevent unauthorized access (viewer role)', async ({ page }) => {
    await openHospitalDay(page, 'viewer');

    const patientInput = page.locator('input[name="patientName"]').first();
    await expect(patientInput).toBeVisible({ timeout: 10000 });
    await expect(patientInput).toHaveAttribute('readonly', '');
  });
});
