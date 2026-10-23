import { expect, test, type Page } from '@playwright/test';

import {
  bootstrapSeededRecord,
  buildCanonicalE2ERecord,
  ensureAuthenticated,
} from './fixtures/auth';

const E2E_DATE = process.env.E2E_FIXED_DATE ?? '2026-02-20';

const buildSmokeRecord = (date: string, clinicalEpisodeId?: string) => {
  const canonical = buildCanonicalE2ERecord(date);
  const beds = canonical.beds as Record<string, Record<string, unknown>>;

  return buildCanonicalE2ERecord(date, {
    beds: {
      ...beds,
      R1: {
        ...beds.R1,
        patientName: 'SMOKE CLINICO',
        rut: '12.345.678-5',
        pathology: 'Control hospitalizado',
        specialty: 'Medicina',
        status: 'Estable',
        age: '45',
        admissionDate: date,
        ...(clinicalEpisodeId ? { clinicalEpisodeId } : {}),
      },
    },
  });
};

const expectAuthenticatedAdminShell = async (page: Page) => {
  await expect(page.getByTestId('authenticated-user-menu-button')).toHaveAttribute(
    'aria-label',
    /Usuario daniel\.opazo@hospitalhangaroa\.cl\. Rol Administrador\. Firebase (Online|Offline|Local)/
  );
};

const openAuthenticatedCensus = async (page: Page, clinicalEpisodeId?: string) => {
  await bootstrapSeededRecord(page, {
    role: 'admin',
    date: E2E_DATE,
    record: buildSmokeRecord(E2E_DATE, clinicalEpisodeId),
    useRuntimeOverride: true,
    forceEditableRecord: true,
  });

  await page.goto(`/censo?date=${E2E_DATE}`);
  await ensureAuthenticated(page);
  await expect(page.getByTestId('census-table')).toBeVisible({ timeout: 20000 });
  await expect(page.locator('[data-testid="patient-row"][data-bed-id="R1"]')).toBeVisible();
  await expectAuthenticatedAdminShell(page);
};

const openClinicalDocumentsFromR1 = async (page: Page) => {
  const patientRow = page.locator('[data-testid="patient-row"][data-bed-id="R1"]').first();
  await expect(patientRow).toBeVisible({ timeout: 10000 });

  const demographicsButton = patientRow.getByRole('button', { name: /Datos del Paciente/i });
  await demographicsButton.focus();
  await expect(page.getByLabel('Acciones clínicas rápidas')).toBeVisible({ timeout: 10000 });
  await page.getByLabel('Acciones clínicas rápidas').click();

  const documentsAction = page.getByTitle('Documentos clínicos');
  await expect(documentsAction).toBeVisible({ timeout: 10000 });
  await documentsAction.click();
  await expect(page.getByTestId('clinical-documents-workspace')).toBeVisible({ timeout: 15000 });
};

const assertExportEntrypointIsOperational = async (page: Page) => {
  await page.goto(`/censo?date=${E2E_DATE}`);
  await expect(page.getByTestId('census-table')).toBeVisible({ timeout: 20000 });

  const saveButton = page.getByRole('button', { name: /guardar|guardado|archivado/i }).first();
  await expect(saveButton).toBeVisible({ timeout: 10000 });
  await saveButton.evaluate((element: HTMLElement) => element.click());

  const localExcelAction = page
    .getByRole('button', { name: /descargar excel.*exportación local inmediata/i })
    .first();
  await expect(localExcelAction).toBeVisible({ timeout: 10000 });

  await localExcelAction.click();
  await expect(page.getByTestId('census-table')).toBeVisible({ timeout: 10000 });
};

test.describe('Authenticated clinical smoke', () => {
  test('preserves empty plan layout choices across autosave and reload', async ({
    page,
  }, testInfo) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width: 1440, height: 900 });
    await openAuthenticatedCensus(page, `ep_document_layout_${testInfo.retry}`);
    await openClinicalDocumentsFromR1(page);
    await page.getByRole('button', { name: /Crear documento/i }).click();

    const restoreStructured = page.getByRole('button', {
      name: 'Volver a indicaciones al alta estructuradas',
      exact: true,
    });
    const simplifyPlan = page.getByRole('button', {
      name: 'Simplificar indicaciones al alta',
      exact: true,
    });
    const unifiedEditor = page.locator('[contenteditable="true"][data-section-editor="plan"]');
    const structuredEditors = page.locator(
      '[contenteditable="true"][data-section-editor^="plan:"]'
    );
    const autosaveStatus = page.locator('[data-autosave-phase]');
    const reloadAndReopenDocuments = async () => {
      await page.reload({ waitUntil: 'domcontentloaded' });
      await expect(page.getByTestId('census-table')).toBeVisible({ timeout: 20000 });
      await expectAuthenticatedAdminShell(page);
      await openClinicalDocumentsFromR1(page);
    };

    await expect(restoreStructured).toBeVisible();
    await expect(unifiedEditor).toHaveText('');
    await restoreStructured.click();
    await expect(simplifyPlan).toBeVisible();
    await expect(structuredEditors).toHaveCount(3);
    await expect(autosaveStatus).toHaveAttribute('data-autosave-phase', 'saved');

    await reloadAndReopenDocuments();
    await expect(simplifyPlan).toBeVisible();
    await expect(structuredEditors).toHaveCount(3);
    for (const editor of await structuredEditors.all()) {
      await expect(editor).toHaveText('');
    }

    await simplifyPlan.click();
    await expect(restoreStructured).toBeVisible();
    await expect(unifiedEditor).toHaveText('');
    await expect(autosaveStatus).toHaveAttribute('data-autosave-phase', 'saved');

    await reloadAndReopenDocuments();
    await expect(restoreStructured).toBeVisible();
    await expect(unifiedEditor).toHaveText('');
    await expect(structuredEditors).toHaveCount(0);
  });

  test('starts a fresh editor session and closes laboratory when duplicating a document', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openAuthenticatedCensus(page);
    await openClinicalDocumentsFromR1(page);
    await page.getByRole('button', { name: /Crear documento/i }).click();

    const editor = page.locator('[contenteditable="true"][data-section-editor]').first();
    await expect(editor).toBeVisible();
    await editor.fill('Texto inicial sintético');
    await editor.blur();
    await editor.fill('Texto sintético del documento original');
    await expect(page.getByRole('button', { name: 'Deshacer', exact: true })).toBeEnabled();
    await page.getByRole('button', { name: 'Insertar contenido' }).click();
    await page.getByRole('button', { name: 'Laboratorio', exact: true }).click();
    await expect(page.getByText('Insertar Laboratorio', { exact: true })).toBeVisible();

    await page.getByTitle('Duplicar documento', { exact: true }).first().click();
    await expect(page.getByTitle('Duplicar documento', { exact: true })).toHaveCount(2);
    await expect(page.getByText('Insertar Laboratorio', { exact: true })).toBeHidden();
    await expect(page.getByRole('button', { name: 'Deshacer', exact: true })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Rehacer', exact: true })).toBeDisabled();
    await expect(editor).toContainText('Texto sintético del documento original');
  });

  test('covers census, clinical documents, and local export entrypoints', async ({ page }) => {
    await openAuthenticatedCensus(page);
    await openClinicalDocumentsFromR1(page);
    await assertExportEntrypointIsOperational(page);
  });

  test('keeps authenticated census shell stable across reload', async ({ page }) => {
    await openAuthenticatedCensus(page);

    await page.reload({ waitUntil: 'domcontentloaded' });

    await expect(page.getByTestId('login-google-button')).toBeHidden({ timeout: 10000 });
    await expect(page.getByTestId('census-table')).toBeVisible({ timeout: 20000 });
    await expect(page.locator('[data-testid="patient-row"][data-bed-id="R1"]')).toBeVisible();
    await expectAuthenticatedAdminShell(page);
  });

  test('undoes the first keyboard edit in an empty section and restores it with redo', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openAuthenticatedCensus(page);
    await openClinicalDocumentsFromR1(page);
    await page.getByRole('button', { name: /Crear documento/i }).click();

    const editor = page.locator('[contenteditable="true"][data-section-editor="antecedentes"]');
    const firstEdit = 'Primera entrada sintetica';
    await expect(editor).toBeVisible();
    await expect(editor).toHaveJSProperty('innerHTML', '');
    await editor.focus();
    await editor.pressSequentially(firstEdit);
    await expect(editor).toHaveText(firstEdit);

    await editor.press('ControlOrMeta+z');
    await expect(editor).toHaveJSProperty('innerHTML', '');

    await editor.press('ControlOrMeta+Shift+z');
    await expect(editor).toHaveText(firstEdit);
  });
});
