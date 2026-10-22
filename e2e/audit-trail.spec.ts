import { test, expect, type Page } from '@playwright/test';
import {
  E2E_DEFAULT_DATE,
  bootstrapSeededRecord,
  buildCanonicalE2ERecord,
  ensureAuthenticated,
} from './fixtures/auth';

const buildAuditLogs = (date: string) =>
  [
    {
      id: `audit-login-${date}`,
      timestamp: `${date}T08:00:00.000Z`,
      userId: 'daniel.opazo@hospitalhangaroa.cl',
      userDisplayName: 'E2E Test Admin',
      action: 'USER_LOGIN',
      entityType: 'user',
      entityId: 'e2e-test-admin-uid',
      summary: 'Inicio de sesión del usuario administrador',
      details: {
        displayName: 'E2E Test Admin',
      },
      recordDate: date,
    },
    {
      id: `audit-patient-${date}`,
      timestamp: `${date}T09:15:00.000Z`,
      userId: 'daniel.opazo@hospitalhangaroa.cl',
      userDisplayName: 'E2E Test Admin',
      action: 'PATIENT_MODIFIED',
      entityType: 'patient',
      entityId: 'R1',
      summary: 'Actualizó datos del paciente de la cama R1',
      details: {
        patientName: 'Audit Patient',
        rut: '12345678-5',
        bedId: 'R1',
        field: 'pathology',
        oldValue: 'Dx previo',
        newValue: 'Neumonía',
        changes: {
          pathology: {
            old: 'Dx previo',
            new: 'Neumonía',
          },
        },
      },
      patientIdentifier: '12345***-*',
      recordDate: date,
    },
    {
      id: `audit-export-${date}`,
      timestamp: `${date}T10:45:00.000Z`,
      userId: 'daniel.opazo@hospitalhangaroa.cl',
      userDisplayName: 'E2E Test Admin',
      action: 'DATA_EXPORTED',
      entityType: 'dailyRecord',
      entityId: date,
      summary: 'Exportó la auditoría del día',
      details: {
        field: 'exportFormat',
        value: 'excel',
      },
      recordDate: date,
    },
  ] as const;

const openAuditView = async (page: Page) => {
  const brandMenuButton = page.getByRole('button', {
    name: /Hospital Hanga Roa/i,
  });
  await expect(brandMenuButton).toBeVisible({ timeout: 10000 });
  await brandMenuButton.click();

  // Auditoría is the first tab of Observabilidad.
  const observabilityButton = page.getByRole('button', { name: 'Observabilidad', exact: true });
  await expect(observabilityButton).toBeVisible({ timeout: 10000 });
  await observabilityButton.click();

  const auditErrorHeading = page.getByRole('heading', { name: /Error en Auditoría/i });
  const retryButton = page.getByRole('button', { name: /Reintentar/i });
  const errorVisible = await auditErrorHeading.isVisible({ timeout: 3000 }).catch(() => false);

  if (errorVisible) {
    await expect(retryButton).toBeVisible({ timeout: 5000 });
    await retryButton.click();
  }

  await expect(page.getByRole('heading', { name: 'Auditoría', exact: true })).toBeVisible({
    timeout: 15000,
  });

  // The seeded events belong to the fixed E2E census day, not to today.
  await page.getByRole('button', { name: 'Rango', exact: true }).click();
  await page.getByLabel('Desde').fill(E2E_DEFAULT_DATE);
  await page.getByLabel('Hasta').fill(E2E_DEFAULT_DATE);
  await expect(page.getByRole('button', { name: /Audit Patient/ })).toBeVisible({
    timeout: 10000,
  });
};

test.describe('Audit Trail Flow', () => {
  test.beforeEach(async ({ page }) => {
    const date = E2E_DEFAULT_DATE;
    const record = buildCanonicalE2ERecord(date, {
      beds: {
        ...((buildCanonicalE2ERecord(date).beds as Record<string, unknown>) || {}),
        R1: {
          ...((buildCanonicalE2ERecord(date).beds as Record<string, Record<string, unknown>>).R1 ||
            {}),
          patientName: 'Audit Patient',
          rut: '12345678-5',
          pathology: 'Dx previo',
          status: 'Estable',
          age: '45',
        },
      },
    });

    await page.addInitScript(
      ({ auditLogs }: { auditLogs: readonly unknown[] }) => {
        localStorage.setItem('hanga_roa_audit_logs', JSON.stringify(auditLogs));
        localStorage.removeItem('indexeddb_migration_complete');
      },
      { auditLogs: buildAuditLogs(date) }
    );

    await bootstrapSeededRecord(page, {
      role: 'admin',
      date,
      record,
      useRuntimeOverride: true,
    });

    await page.goto(`/censo?date=${date}`);
    await ensureAuthenticated(page);
    await expect(page.getByTestId('census-table')).toBeVisible({ timeout: 20000 });
    await expect
      .poll(
        async () =>
          page.evaluate(() => window.localStorage.getItem('indexeddb_migration_complete')),
        { timeout: 10000 }
      )
      .toBe('true');
  });

  test('should navigate to audit view', async ({ page }) => {
    await openAuditView(page);

    await expect(page.getByRole('button', { name: /Cambios\s*1/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /Accesos\s*1/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /Conexiones\s*1/ })).toBeVisible();
  });

  test('should filter audit logs by staff member', async ({ page }) => {
    await openAuditView(page);

    await page.getByLabel('Funcionario').selectOption('daniel.opazo@hospitalhangaroa.cl');
    await expect(page.getByRole('button', { name: /Audit Patient/ })).toBeVisible();
  });

  test('should show action details', async ({ page }) => {
    await openAuditView(page);

    await page.getByRole('button', { name: /Audit Patient/ }).click();
    await expect(page.getByText('Dx previo', { exact: true })).toBeVisible();
    await expect(page.getByText('Neumonía', { exact: true })).toBeVisible();
  });

  test('should export audit logs', async ({ page }) => {
    await openAuditView(page);

    const exportButton = page.getByRole('button', { name: /Exportar/i }).first();
    await expect(exportButton).toBeVisible();
    await exportButton.click();

    await expect(exportButton).toBeVisible();
  });

  test('should display audit entries for different action types', async ({ page }) => {
    await openAuditView(page);

    await page.getByRole('button', { name: /Conexiones\s*1/ }).click();
    await page.getByRole('button', { name: 'Cronológico', exact: true }).click();
    const dayLabel = E2E_DEFAULT_DATE.split('-').reverse().join('-');
    await page.getByRole('button', { name: new RegExp(dayLabel) }).click();

    await expect(page.getByText('Inicio de sesión').first()).toBeVisible();
    await expect(page.getByText('Diagnóstico').first()).toBeVisible();
    await expect(page.getByText('Exportación').first()).toBeVisible();
  });
});
