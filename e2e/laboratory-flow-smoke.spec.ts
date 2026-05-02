import { expect, test, type Page, type Route } from '@playwright/test';

import {
  bootstrapSeededRecord,
  buildCanonicalE2ERecord,
  ensureAuthenticated,
} from './fixtures/auth';

const E2E_DATE = process.env.E2E_FIXED_DATE ?? '2026-02-20';
const LAB_PATIENT_NAME = 'PACIENTE LAB E2E';
const LAB_PATIENT_RUT = '12.345.678-5';
const FIRST_EXAM_LINK = 'https://syslab.test/exams/43092336';
const SECOND_EXAM_LINK = 'https://syslab.test/exams/43070704';

const corsHeaders = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': '*',
  'access-control-allow-methods': 'GET,POST,OPTIONS',
};

const buildLabRecord = (date: string) => {
  const canonical = buildCanonicalE2ERecord(date);
  const beds = canonical.beds as Record<string, Record<string, unknown>>;

  return buildCanonicalE2ERecord(date, {
    beds: {
      ...beds,
      R1: {
        ...beds.R1,
        patientName: LAB_PATIENT_NAME,
        rut: LAB_PATIENT_RUT,
        pathology: 'Control laboratorio E2E',
        specialty: 'Medicina',
        status: 'Estable',
        age: '45',
        admissionDate: date,
        birthDate: '1980-04-12',
      },
    },
  });
};

const fulfillOptionsPreflight = async (route: Route) => {
  if (route.request().method() !== 'OPTIONS') {
    return false;
  }

  await route.fulfill({
    status: 204,
    headers: corsHeaders,
    body: '',
  });
  return true;
};

const routeSyslabMocks = async (page: Page) => {
  await page.route('**/health', async route => {
    if (await fulfillOptionsPreflight(route)) {
      return;
    }

    await route.fulfill({
      status: 200,
      headers: { ...corsHeaders, 'content-type': 'application/json' },
      json: { connected: true },
    });
  });

  await page.route('**/api/exams?**', async route => {
    if (await fulfillOptionsPreflight(route)) {
      return;
    }

    await route.fulfill({
      status: 200,
      headers: { ...corsHeaders, 'content-type': 'application/json' },
      json: {
        success: true,
        data: [
          {
            id: '43092336',
            link: FIRST_EXAM_LINK,
            date: '28/04/2026',
            time: '10:16:45',
            patientName: LAB_PATIENT_NAME,
            origin: 'Hospitalizados',
            exams: ['HEMOGRAMA #NUEVO.', 'CREATININA.', 'UREMIA-BUN.', 'PROTEINA C REACTIVA.'],
          },
          {
            id: '43070704',
            link: SECOND_EXAM_LINK,
            date: '18/10/2024',
            time: '08:22:45',
            patientName: LAB_PATIENT_NAME,
            origin: 'Hospitalizados',
            exams: ['HEMOGRAMA #NUEVO.', 'CREATININA.', 'UREMIA-BUN.'],
          },
        ],
      },
    });
  });

  await page.route('**/api/exams/details', async route => {
    if (await fulfillOptionsPreflight(route)) {
      return;
    }

    await route.fulfill({
      status: 200,
      headers: { ...corsHeaders, 'content-type': 'application/json' },
      json: {
        success: true,
        data: [
          {
            url: FIRST_EXAM_LINK,
            findings: [
              {
                section: 'HEMOGRAMA',
                analysis: 'Hemoglobina',
                result: '14,0',
                unit: 'g/dL',
                refValue: '12-16',
              },
              {
                section: 'HEMOGRAMA',
                analysis: 'Recuento Leucocitos',
                result: '8,1',
                unit: 'x10^3/uL',
                refValue: '4-11',
              },
              {
                section: 'FUNCION RENAL',
                analysis: 'Creatinina',
                result: '1,0',
                unit: 'mg/dL',
                refValue: '0,6-1,2',
              },
              {
                section: 'FUNCION RENAL',
                analysis: 'Uremia-Bun',
                result: '20',
                unit: 'mg/dL',
                refValue: '7-20',
              },
            ],
          },
          {
            url: SECOND_EXAM_LINK,
            findings: [
              {
                section: 'HEMOGRAMA',
                analysis: 'Hemoglobina',
                result: '12,8',
                unit: 'g/dL',
                refValue: '12-16',
              },
              {
                section: 'HEMOGRAMA',
                analysis: 'Recuento Leucocitos',
                result: '15,5',
                unit: 'x10^3/uL',
                refValue: '4-11',
              },
              {
                section: 'FUNCION RENAL',
                analysis: 'Creatinina',
                result: '1,2',
                unit: 'mg/dL',
                refValue: '0,6-1,2',
              },
              {
                section: 'FUNCION RENAL',
                analysis: 'Uremia-Bun',
                result: '35',
                unit: 'mg/dL',
                refValue: '7-20',
              },
            ],
          },
        ],
      },
    });
  });
};

const openAuthenticatedCensus = async (page: Page) => {
  await routeSyslabMocks(page);
  await bootstrapSeededRecord(page, {
    role: 'admin',
    date: E2E_DATE,
    record: buildLabRecord(E2E_DATE),
    useRuntimeOverride: true,
    forceEditableRecord: true,
  });

  await page.goto(`/censo?date=${E2E_DATE}`);
  await ensureAuthenticated(page);
  await expect(page.getByTestId('census-table')).toBeVisible({ timeout: 20000 });
  await expect(page.locator('[data-testid="patient-row"][data-bed-id="R1"]')).toBeVisible();
};

test.describe('Laboratory UI smoke', () => {
  test('searches Syslab, analyzes selected exams, and exports trend/comparison outputs', async ({
    page,
  }) => {
    test.setTimeout(90_000);

    await openAuthenticatedCensus(page);

    const labAction = page.getByTestId('lab-quick-action').first();
    await expect(labAction).toBeVisible({ timeout: 15000 });
    await labAction.click();

    const labDialog = page.getByTestId('lab-results-viewer-modal');
    await expect(labDialog).toBeVisible({ timeout: 15000 });
    await expect(labDialog).toContainText(LAB_PATIENT_NAME);
    await expect(labDialog).toContainText(LAB_PATIENT_RUT);

    await labDialog.getByRole('button', { name: /^Buscar$/ }).click();
    await expect(labDialog.getByTestId('lab-exam-card-43092336')).toBeVisible({
      timeout: 20000,
    });
    await expect(labDialog.getByText('Ordenes disponibles')).toBeVisible();
    await expect(labDialog.getByText('2', { exact: true }).first()).toBeVisible();
    await expect(labDialog.getByRole('button', { name: 'Bioquímica' })).toHaveCount(0);

    await labDialog.getByRole('button', { name: 'Seleccionar todo' }).click();
    await expect(labDialog.getByRole('checkbox', { name: /43092336/ })).toHaveAttribute(
      'aria-checked',
      'true'
    );
    await expect(labDialog.getByRole('button', { name: /Analizar \(2\)/ })).toBeVisible();
    await labDialog.getByRole('button', { name: /Analizar \(2\)/ }).click();

    await expect(labDialog.getByRole('button', { name: /Tendencias/ })).toBeVisible({
      timeout: 20000,
    });
    await expect(labDialog.getByText('Hemoglobina')).toBeVisible();

    const pngDownload = page.waitForEvent('download', { timeout: 20000 });
    await labDialog.getByRole('button', { name: 'Descargar PNG' }).click();
    await expect((await pngDownload).suggestedFilename()).toMatch(
      /^laboratorio_tendencias_.*\.png$/
    );
    await expect(labDialog.getByText('No se pudo descargar PNG.')).toHaveCount(0);

    await labDialog.getByRole('button', { name: 'Comparacion' }).click();
    await expect(labDialog.getByRole('button', { name: /Solo fecha/ })).toBeVisible();
    await expect(labDialog.getByRole('button', { name: /Fecha \+ hora/ })).toBeVisible();
    await expect(labDialog.getByText('28/04/2026 10:16')).toBeVisible();

    const hideFirstColumn = labDialog.getByTitle(/Ocultar columna/).last();
    await hideFirstColumn.click();
    await expect(labDialog.getByRole('button', { name: /Mostrar columnas \(1\)/ })).toBeVisible();

    await labDialog.getByRole('button', { name: 'Exportar Excel' }).click();
    await expect(labDialog.getByText('Configurar exportacion Excel')).toBeVisible();

    const excelDownload = page.waitForEvent('download', { timeout: 20000 });
    await labDialog.getByRole('button', { name: 'Exportar Excel' }).last().click();
    await expect((await excelDownload).suggestedFilename()).toMatch(
      /^laboratorio_comparacion_.*\.xlsx$/
    );
  });
});
