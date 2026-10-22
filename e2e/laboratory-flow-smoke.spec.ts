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
  // Exercise the real HHR message bridge with a synthetic extension endpoint.
  await page.addInitScript(() => {
    window.addEventListener('message', async event => {
      const request = event.data;
      if (
        event.source !== window ||
        !request?.type?.startsWith('HHR_RAYEN_SYSLAB_') ||
        !request.type.endsWith('_REQUEST')
      )
        return;
      let response: Record<string, unknown>;
      if (request.type === 'HHR_RAYEN_SYSLAB_STATUS_REQUEST') {
        response = { connected: true, ok: true };
      } else if (request.type === 'HHR_RAYEN_SYSLAB_SEARCH_REQUEST') {
        const result = await fetch(`https://syslab.test/api/exams?rut=${request.rutBody}`).then(
          res => res.json()
        );
        response = {
          ok: true,
          batchId: '123e4567-e89b-12d3-a456-426614174000',
          rutBody: request.rutBody,
          exams: result.data,
        };
      } else if (request.type === 'HHR_RAYEN_SYSLAB_DETAILS_REQUEST') {
        const result = await fetch('https://syslab.test/api/exams/details', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ links: request.links }),
        }).then(res => res.json());
        response = {
          ok: true,
          analysis: {
            reports: result.data.map((detail: { url: string; findings: unknown[] }) => ({
              examId: detail.url.split('/').pop(),
              findings: detail.findings,
            })),
          },
        };
      } else return;
      window.postMessage(
        { type: request.type.replace(/_REQUEST$/, '_RESULT'), reqId: request.reqId, response },
        location.origin
      );
    });
  });
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
  }, testInfo) => {
    test.setTimeout(90_000);

    await openAuthenticatedCensus(page);

    await page.getByRole('button', { name: 'Más opciones del censo' }).click();
    const labAction = page.getByTestId('lab-quick-action').filter({ visible: true }).first();
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

    await expect(labDialog.getByText('4/26', { exact: true }).first()).toBeVisible();
    await labDialog.screenshot({ path: testInfo.outputPath('laboratory-sparse-labels.png') });
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
  test('analyzes 26 reports without dropping measurements or overcrowding chart labels', async ({
    page,
  }, testInfo) => {
    test.setTimeout(90_000);
    await openAuthenticatedCensus(page);
    const exams = Array.from({ length: 26 }, (_, i) => ({
      id: String(900000 + i),
      link: `https://syslab.test/exams/${900000 + i}`,
      date: `${String(i + 1).padStart(2, '0')}/10/2026`,
      time: '10:00:00',
      patientName: LAB_PATIENT_NAME,
      origin: 'TEST',
      exams: ['CREATININA'],
    }));
    await page.route('**/api/exams?**', async route => {
      if (await fulfillOptionsPreflight(route)) return;
      await route.fulfill({ headers: corsHeaders, json: { success: true, data: exams } });
    });
    const batchSizes: number[] = [];
    await page.route('**/api/exams/details', async route => {
      if (await fulfillOptionsPreflight(route)) return;
      const { links } = route.request().postDataJSON() as { links: string[] };
      batchSizes.push(links.length);
      await route.fulfill({
        headers: corsHeaders,
        json: {
          success: true,
          data: links.map((url: string) => ({
            url,
            findings: [
              {
                section: 'FUNCION RENAL',
                analysis: 'Creatinina',
                result: '0,64',
                unit: Number(url.split('/').pop()) % 2 ? 'mg/dL |' : 'mg/dL',
                refValue: '0,5-1,1',
              },
            ],
          })),
        },
      });
    });
    await page.getByRole('button', { name: 'Más opciones del censo' }).click();
    await page.getByTestId('lab-quick-action').filter({ visible: true }).first().click();
    const dialog = page.getByTestId('lab-results-viewer-modal');
    await dialog.getByRole('button', { name: /^Buscar$/ }).click();
    await expect(dialog.getByTestId('lab-exam-card-900025')).toBeAttached();
    await dialog.getByRole('button', { name: 'Seleccionar todo' }).click();
    await dialog.getByRole('button', { name: /Analizar \(26\)/ }).click();
    await expect(dialog.getByRole('button', { name: /Tendencias/ })).toBeVisible({
      timeout: 20000,
    });
    expect(batchSizes).toEqual([3, 3, 3, 3, 3, 3, 3, 3, 2]);
    await expect(dialog.locator('.recharts-line-dot')).toHaveCount(26);
    await expect(dialog.locator('.recharts-wrapper')).toHaveCount(1);
    await expect(dialog.getByText('10/26', { exact: true })).toBeVisible();
    await expect(dialog).not.toContainText('mg/dL |');
    await expect(
      dialog.getByText('Pasa sobre un punto para ver su valor y referencia.')
    ).toBeVisible();
    await dialog.locator('.recharts-line-dot').last().hover();
    await expect(dialog.getByText('Original Syslab: 0,64')).toBeVisible();
    await dialog.screenshot({ path: testInfo.outputPath('laboratory-dense-chart.png') });
  });
});
