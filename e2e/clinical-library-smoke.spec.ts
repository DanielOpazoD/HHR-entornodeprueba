/**
 * Smoke de la biblioteca clínica sobre el build de preview.
 *
 * Reutiliza la semilla del arnés de preview del censo (sesión E2E + registro
 * persistido) y recorre el botón «Documentos», la búsqueda, un documento y las
 * tres herramientas. Guarda capturas en `CLINICAL_LIBRARY_SHOTS_DIR` (o en el
 * directorio de salida del test) para revisión visual.
 *
 *   PLAYWRIGHT_SKIP_PREVIEW_BUILD=1 npx playwright test -c playwright.preview.config.ts \
 *     e2e/clinical-library-smoke.spec.ts --project=chromium
 */

import fs from 'node:fs';
import path from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';
import { PatientStatus } from '../src/types/domain/patientClassification';
import { buildCanonicalE2ERecord, MOCK_USERS } from './fixtures/auth';
import {
  installPreviewFirebaseRuntime,
  type FirebasePreviewConfig,
} from './fixtures/previewFirebase';

const PREVIEW_DATE = process.env.E2E_FIXED_DATE ?? '2026-04-03';
const SEEDED_PATIENT_NAME = 'PACIENTE VALIDACION PREVIEW';

const seedPersistedSession = async (page: Page) => {
  const firebaseConfig = await installPreviewFirebaseRuntime(page);
  const baseRecord = buildCanonicalE2ERecord(PREVIEW_DATE) as Record<string, unknown>;
  const baseBeds = baseRecord.beds as Record<string, Record<string, unknown>>;
  const record = buildCanonicalE2ERecord(PREVIEW_DATE, {
    beds: {
      ...baseBeds,
      R1: {
        ...baseBeds.R1,
        patientName: SEEDED_PATIENT_NAME,
        biologicalSex: 'Femenino',
        rut: '12345678-5',
        pathology: 'DIAGNOSTICO PREVIEW',
        age: '44',
        admissionDate: '2026-03-29',
        status: PatientStatus.ESTABLE,
      },
    },
  });

  await page.addInitScript(
    ({
      bootstrapUser,
      date,
      seededRecord,
      runtimeConfig,
    }: {
      bootstrapUser: unknown;
      date: string;
      seededRecord: unknown;
      runtimeConfig: FirebasePreviewConfig;
    }) => {
      const runtimeWindow = window as Window & { __HHR_E2E_OVERRIDE__?: Record<string, unknown> };
      runtimeWindow.__HHR_E2E_OVERRIDE__ = {
        ...(runtimeWindow.__HHR_E2E_OVERRIDE__ || {}),
        [date]: seededRecord,
      };
      localStorage.setItem('hhr_e2e_bootstrap_user', JSON.stringify(bootstrapUser));
      localStorage.setItem('firebase:authUser:test:[DEFAULT]', JSON.stringify({ uid: 'preview' }));
      localStorage.setItem('hhr_firebase_config', JSON.stringify(runtimeConfig));
      const existing = JSON.parse(localStorage.getItem('hanga_roa_hospital_data') || '{}');
      existing[date] = seededRecord;
      localStorage.setItem('hanga_roa_hospital_data', JSON.stringify(existing));
    },
    {
      bootstrapUser: MOCK_USERS.admin,
      date: PREVIEW_DATE,
      seededRecord: record,
      runtimeConfig: firebaseConfig,
    }
  );
};

const shotsDir = (): string => {
  const dir = process.env.CLINICAL_LIBRARY_SHOTS_DIR || test.info().outputDir;
  fs.mkdirSync(dir, { recursive: true });
  return dir;
};

const capture = async (page: Page, name: string) => {
  await page.screenshot({ path: path.join(shotsDir(), `${name}.png`), fullPage: false });
};

test.describe('Clinical library (preview build)', () => {
  test.describe.configure({ timeout: 90_000 });
  test.use({ viewport: { width: 1440, height: 900 } });

  test('opens the Documentos panel from the census and drives every tool', async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', error => pageErrors.push(error.message));

    await seedPersistedSession(page);
    await page.goto(`/?date=${PREVIEW_DATE}`);
    await expect(
      page.locator('[data-testid="patient-row"][data-bed-id="R1"] input[name="patientName"]')
    ).toHaveValue(SEEDED_PATIENT_NAME, { timeout: 20_000 });

    // The feature quick actions mount after the startup delay and a lazy chunk.
    const trigger = page.getByTestId('clinical-library-quick-action');
    await expect(trigger).toBeVisible({ timeout: 15_000 });
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await capture(page, '01-census-with-documents-button');

    await trigger.click();
    const drawer = page.getByTestId('clinical-library-drawer');
    await expect(drawer).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('dialog', { name: 'Documentos y herramientas' })).toBeVisible();
    await expect(page.getByRole('searchbox')).toBeFocused();
    await expect(drawer.getByTestId('library-document-consentimiento-informado')).toBeVisible();
    await expect(drawer.getByText('Aún no hay protocolos publicados')).toHaveCount(0);
    await expect(drawer.getByTestId('library-document-consentimiento-informado')).toContainText(
      'PDF · 1 pág.'
    );
    await drawer.getByRole('button', { name: 'Protocolos' }).click();
    await expect(drawer.getByText('Aún no hay protocolos publicados')).toBeVisible();
    await drawer.getByRole('button', { name: 'Todo' }).click();
    await capture(page, '02-documents-panel');

    await page.getByRole('searchbox').fill('imagenologia');
    await expect(drawer.getByTestId('library-document-solicitud-imagenologia')).toBeVisible();
    await expect(drawer.getByTestId('library-document-consentimiento-informado')).toHaveCount(0);
    await capture(page, '03-search-imagenologia');
    await page.getByRole('button', { name: 'Limpiar búsqueda' }).click();

    // El preview debe servir el PDF real que imprime la fila.
    await expect(
      drawer
        .getByTestId('library-document-solicitud-tuberculosis')
        .getByRole('button', { name: /^Imprimir/ })
    ).toBeVisible();
    const pdfResponse = await page.request.get(
      '/docs/biblioteca/solicitud-tuberculosis-minsal.pdf'
    );
    expect(pdfResponse.status()).toBe(200);
    expect(pdfResponse.headers()['content-type']).toContain('pdf');

    await drawer.getByTestId('library-tool-infusion').click();
    await expect(drawer.getByTestId('library-tool-infusion')).toBeVisible();
    await drawer.getByLabel('Peso').fill('70');
    await drawer.getByLabel('Dosis indicada').fill('0,1');
    await expect(drawer.getByTestId('infusion-result')).toContainText('26,3');
    await expect(drawer.getByTestId('infusion-range')).toHaveAttribute('data-assessment', 'within');
    await capture(page, '04-infusion-noradrenalina');

    await drawer.getByRole('button', { name: 'Volver a la biblioteca' }).click();
    await drawer.getByTestId('library-tool-dosing').click();
    await drawer.getByLabel('Edad').fill('60');
    await drawer.getByLabel('Peso real').fill('70');
    await drawer.getByLabel('Talla').fill('170');
    await drawer.getByLabel('Creatinina').fill('1');
    await drawer.getByLabel('Dosis por kilo').fill('1,5');
    await expect(drawer.getByTestId('dosing-clearance')).toContainText('78');
    await expect(drawer.getByTestId('dosing-total')).toContainText('105');
    await capture(page, '05-dosing');

    // Carátula de traslado prellenada con el paciente del censo; la impresión se captura sin abrir pestañas.
    await drawer.getByRole('button', { name: 'Volver a la biblioteca' }).click();
    await drawer.getByTestId('library-tool-transfer-cover').click();
    await page.evaluate(() => {
      const runtimeWindow = window as Window & { __hhrPrintedHtml?: string };
      runtimeWindow.open = (() => ({
        document: {
          open: () => undefined,
          write: (html: string) => {
            runtimeWindow.__hhrPrintedHtml = html;
          },
          close: () => undefined,
          readyState: 'complete',
        },
        focus: () => undefined,
        print: () => undefined,
        setTimeout: (callback: () => void) => callback(),
        addEventListener: () => undefined,
      })) as unknown as typeof window.open;
    });
    await drawer.getByLabel('Desde el censo').selectOption('R1');
    await expect(drawer.getByLabel('Nombre y apellidos')).toHaveValue(SEEDED_PATIENT_NAME);
    await expect(drawer.getByLabel('Fecha de ingreso a Hospital Hanga Roa')).toHaveValue(
      '2026-03-29'
    );
    await capture(page, '08-transfer-cover');
    await drawer.getByTestId('transfer-cover-print').click();
    const printedHtml = await page.evaluate(
      () => (window as Window & { __hhrPrintedHtml?: string }).__hhrPrintedHtml ?? ''
    );
    expect(printedHtml).toContain('legal landscape');
    expect(printedHtml).toContain(SEEDED_PATIENT_NAME);
    expect(printedHtml).toContain('12345678-5');
    expect(printedHtml).toContain('Fecha de ingreso a Hospital Hanga Roa');
    expect(printedHtml).toContain('29-03-2026');

    await drawer.getByRole('button', { name: 'Volver a la biblioteca' }).click();
    await drawer.getByTestId('library-tool-critical-medications').click();
    await expect(drawer.getByTestId('critical-medication-dopamina')).toContainText('250 mg/5 mL');
    await capture(page, '09-critical-medications');

    await drawer.getByRole('button', { name: 'Volver a la biblioteca' }).click();
    await drawer.getByTestId('library-tool-scores').click();
    await drawer.getByRole('button', { name: 'Glasgow' }).click();
    await drawer.getByLabel(/^Espontánea/).check();
    await drawer.getByLabel(/^Orientado/).check();
    await drawer.getByLabel(/^Obedece órdenes/).check();
    await expect(drawer.getByTestId('score-result')).toHaveAttribute('data-band', 'Leve');
    await capture(page, '06-scores-glasgow');

    // Dentro de una herramienta, Escape vuelve a la lista; en la lista, cierra el panel.
    await page.keyboard.press('Escape');
    await expect(drawer.getByRole('searchbox')).toBeVisible();
    await expect(drawer.getByTestId('library-tool-scores')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(drawer).toHaveCount(0);
    await expect(trigger).toBeFocused();

    // Pantalla angosta: el botón conserva su nombre y el panel ocupa el ancho útil.
    await page.setViewportSize({ width: 375, height: 812 });
    const mobileTrigger = page.getByRole('button', { name: 'Documentos' });
    await expect(mobileTrigger).toBeVisible();
    await mobileTrigger.click();
    await expect(page.getByTestId('clinical-library-drawer')).toBeVisible();
    const box = await page.getByTestId('clinical-library-drawer').boundingBox();
    // El overlay inset-0 mide el área de posicionamiento fijo, descontando el gutter.
    // clientWidth puede incluirlo cuando el scroll está bloqueado al abrir el modal.
    const overlayBox = await page.getByTestId('clinical-library-overlay').boundingBox();
    expect(overlayBox).not.toBeNull();
    expect(box?.width).toBe(overlayBox!.width);
    expect(box?.x).toBe(0);
    await capture(page, '07-mobile-panel');
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('clinical-library-drawer')).toHaveCount(0);
    expect(pageErrors).toEqual([]);
  });
});

test('fills the compact MEDIF from the census, restores its preset and prints the original PDF', async ({
  page,
}) => {
  test.setTimeout(90_000);
  const pageErrors: string[] = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  await seedPersistedSession(page);
  await page.goto(`/?date=${PREVIEW_DATE}`);
  await expect(
    page.locator('[data-testid="patient-row"][data-bed-id="R1"] input[name="patientName"]')
  ).toHaveValue(SEEDED_PATIENT_NAME, { timeout: 20_000 });
  await page.getByTestId('clinical-library-quick-action').click({ timeout: 15_000 });
  const drawer = page.getByTestId('clinical-library-drawer');
  await drawer.getByTestId('library-tool-medif').click();
  const editor = drawer.getByTestId('library-tool-medif');
  await expect(editor.locator('#medif-p1_nombre_pasajero')).toBeVisible();
  await expect(editor.getByRole('tablist')).toHaveCount(0);
  await expect(editor.locator('#medif-p2_instrucciones_si')).toBeAttached();
  await expect(editor.locator('#medif-p2_nombre_paciente')).toHaveCount(0);
  await expect(editor.locator('#medif-p2_edad')).toHaveCount(0);
  await expect(editor.locator('#medif-p1_seguro_viaje')).toHaveCount(0);
  await expect(editor.locator('#medif-p3_firma_medico_texto')).toBeAttached();
  await expect(editor.getByRole('button', { name: /^(Anterior|Siguiente)$/ })).toHaveCount(0);

  const source = editor.getByLabel('Origen de los datos');
  const patientKey = await source
    .locator('option')
    .filter({ hasText: SEEDED_PATIENT_NAME })
    .getAttribute('value');
  expect(patientKey).toBeTruthy();
  await source.selectOption(patientKey!);
  await expect(editor.locator('#medif-p1_nombre_pasajero')).toHaveValue(SEEDED_PATIENT_NAME);
  await expect(editor.locator('#medif-p1_edad')).toHaveValue('44');
  await expect(editor.locator('#medif-p2_diagnostico_actual')).toHaveValue('DIAGNOSTICO PREVIEW');
  await expect(editor.locator('#medif-p2_genero')).toHaveValue('Femenino');
  await expect(editor.locator('#medif-p2_contagiosa_fecha_tipo')).toHaveValue('29/03/2026');
  await expect(editor.locator('#medif-p2_comer_si')).not.toBeChecked();
  await editor.locator('#medif-p1_itinerario_1_hacia').fill('Destino editado');
  await editor.locator('#medif-p2_medicacion_previa_si').check();
  await editor.getByRole('button', { name: 'Respuestas habituales', exact: true }).click();
  await expect(editor.locator('#medif-p2_comer_si')).toBeChecked();
  await expect(editor.locator('#medif-p1_especiales_no')).toBeChecked();
  await expect(editor.locator('#medif-p2_instrucciones_si')).toBeChecked();
  await expect(editor.locator('#medif-p2_medicacion_previa_si')).toBeChecked();
  await expect(editor.locator('#medif-p2_medicacion_previa_no')).not.toBeChecked();
  await expect(editor.locator('#medif-p1_itinerario_1_desde')).toHaveValue('Isla de pascua');
  await expect(editor.locator('#medif-p1_itinerario_1_hacia')).toHaveValue('Destino editado');
  await expect(
    editor.getByRole('textbox', { name: 'Nombre del médico tratante', exact: true })
  ).toHaveCount(1);
  await expect(editor.locator('#medif-p1_medico_autorizado')).toHaveCount(0);
  await expect(editor.locator('#medif-p3_medico_declaracion')).toHaveCount(0);
  await editor.locator('#medif-p2_nombre_medico').fill('Dra. PRUEBA MEDIF');

  await editor.getByRole('button', { name: 'Configurar MEDIF', exact: true }).click();
  await editor.getByRole('tab', { name: 'Preferencias', exact: true }).click();
  await expect(editor.getByText(/44\s+de\s+137\s+casilleros ocultos/)).toBeVisible();
  await editor.getByRole('button', { name: 'Mostrar todos', exact: true }).click();
  await editor.getByRole('tab', { name: 'Formulario', exact: true }).click();
  await editor.locator('#medif-p1_seguro_viaje').fill('DATO OCULTO DE PRUEBA');
  await editor.getByRole('tab', { name: 'Preferencias', exact: true }).click();
  await editor.getByRole('button', { name: 'Restaurar selección MEDIF', exact: true }).click();
  await expect(editor.getByText(/44\s+de\s+137\s+casilleros ocultos/)).toBeVisible();
  const preferencesDownload = page.waitForEvent('download');
  await editor.getByRole('button', { name: 'Exportar preferencias', exact: true }).click();
  const preferencesPath = test.info().outputPath('medif-preferencias.json');
  await (await preferencesDownload).saveAs(preferencesPath);
  const preferences = JSON.parse(fs.readFileSync(preferencesPath, 'utf8'));
  expect(Object.keys(preferences).sort()).toEqual(['hiddenFieldIds', 'version']);
  expect(preferences.version).toBe(3);
  expect(preferences.hiddenFieldIds).toHaveLength(44);
  expect(preferences.hiddenFieldIds).toContain('p1_seguro_viaje');

  await editor.getByRole('tab', { name: 'Formulario', exact: true }).click();
  await expect(editor.locator('#medif-p1_seguro_viaje')).toHaveCount(0);
  await editor.getByRole('button', { name: 'Configurar MEDIF', exact: true }).click();
  await expect(editor.getByRole('tablist')).toHaveCount(0);
  const editableDownload = page.waitForEvent('download');
  await editor.getByRole('button', { name: 'PDF editable', exact: true }).click();
  const editablePath = test.info().outputPath('medif-editable.pdf');
  await (await editableDownload).saveAs(editablePath);
  const editable = await PDFDocument.load(new Uint8Array(fs.readFileSync(editablePath)));
  for (const id of ['p2_nombre_medico', 'p1_medico_autorizado', 'p3_medico_declaracion']) {
    expect(editable.getForm().getTextField(id).getText()).toBe('Dra. PRUEBA MEDIF');
  }
  expect(editable.getForm().getTextField('p2_comer_si').getText()).toBe('X');
  expect(editable.getForm().getTextField('p1_especiales_no').getText()).toBe('X');
  expect(editable.getForm().getTextField('p2_instrucciones_si').getText()).toBe('X');
  expect(editable.getForm().getTextField('p2_medicacion_previa_si').getText()).toBe('X');
  expect(editable.getForm().getTextField('p2_medicacion_previa_no').getText() || '').toBe('');
  expect(editable.getForm().getTextField('p2_genero').getText()).toBe('Femenino');
  expect(editable.getForm().getTextField('p2_contagiosa_fecha_tipo').getText()).toBe('29/03/2026');
  const pdfDownload = page.waitForEvent('download');
  await editor.getByRole('button', { name: 'PDF imprimible', exact: true }).click();
  const pdfPath = test.info().outputPath('medif-imprimible.pdf');
  await (await pdfDownload).saveAs(pdfPath);
  const pdf = await PDFDocument.load(new Uint8Array(fs.readFileSync(pdfPath)));
  expect(pdf.getPageCount()).toBe(3);
  expect(pdf.getForm().getFields()).toHaveLength(0);

  await source.selectOption('');
  await editor.getByRole('button', { name: 'Reemplazar todos los datos', exact: true }).click();
  await expect(editor.locator('#medif-p1_nombre_pasajero')).toHaveValue('');
  await expect(editor.locator('#medif-p2_diagnostico_actual')).toHaveValue('');
  await expect(editor.locator('#medif-p2_nombre_medico')).toHaveValue('');
  await expect(editor.locator('#medif-p2_genero')).toHaveValue('');
  await expect(editor.locator('#medif-p2_contagiosa_fecha_tipo')).toHaveValue('');
  await expect(editor.locator('#medif-p2_comer_si')).not.toBeChecked();
  await expect(editor.locator('#medif-p1_seguro_viaje')).toHaveCount(0);
  await capture(page, '10-medif-compact-desktop');
  await page.setViewportSize({ width: 375, height: 812 });
  await expect(editor.locator('#medif-p1_nombre_pasajero')).toBeVisible();
  expect(await editor.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(
    true
  );
  await capture(page, '11-medif-compact-mobile');
  expect(pageErrors).toEqual([]);
});
