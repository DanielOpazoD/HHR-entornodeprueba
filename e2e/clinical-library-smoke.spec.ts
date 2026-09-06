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
        rut: '12345678-5',
        pathology: 'DIAGNOSTICO PREVIEW',
        age: '44',
        status: 'ESTABLE',
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
    await expect(drawer.getByTestId('library-document-instrumento-cudyr')).toBeVisible();
    await expect(drawer.getByText('Aún no hay protocolos publicados')).toBeVisible();
    await capture(page, '02-documents-panel');

    await page.getByRole('searchbox').fill('imagenologia');
    await expect(drawer.getByTestId('library-document-solicitud-imagenologia')).toBeVisible();
    await expect(drawer.getByTestId('library-document-instrumento-cudyr')).toHaveCount(0);
    await capture(page, '03-search-imagenologia');
    await page.getByRole('button', { name: 'Limpiar búsqueda' }).click();

    // El preview debe servir el PDF real que imprime la fila.
    await expect(
      drawer
        .getByTestId('library-document-indicaciones-medicas-plan-enfermeria')
        .getByRole('button', { name: /^Imprimir/ })
    ).toBeVisible();
    const pdfResponse = await page.request.get(
      '/docs/biblioteca/indicaciones-medicas-plan-enfermeria.pdf'
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

    // Pantalla angosta: el botón queda sólo con icono pero conserva su nombre, y el panel ocupa todo el ancho.
    // A 375 px la barra superior de la app cubre parte de la barra de fechas (comportamiento
    // preexistente del censo): se activa por teclado para verificar el panel a ancho completo.
    await page.setViewportSize({ width: 375, height: 812 });
    const mobileTrigger = page.getByRole('button', { name: 'Documentos' });
    await expect(mobileTrigger).toBeVisible();
    await mobileTrigger.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('clinical-library-drawer')).toBeVisible();
    const box = await page.getByTestId('clinical-library-drawer').boundingBox();
    expect(box?.width).toBe(375);
    await capture(page, '07-mobile-panel');
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('clinical-library-drawer')).toHaveCount(0);
    expect(pageErrors).toEqual([]);
  });
});
