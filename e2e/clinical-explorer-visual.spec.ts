import { writeFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { panelResult } from '../src/tests/views/census/clinicalPanelDrawer.fixture';
import {
  seedVisualCensus,
  VISUAL_DATE as DATE,
  VISUAL_PATIENT as PATIENT,
  VISUAL_SECOND_PATIENT as SECOND_PATIENT,
} from './fixtures/censusVisualSeed';
import { openPatientClinicalTopic } from './fixtures/patientClinicalTopics';

const openExplorerFromBed = async (page: Page, bedId: string): Promise<void> => {
  await openPatientClinicalTopic(page, bedId, 'Ficha clínica');
  const drawer = page.getByTestId(`clinical-panel-drawer-${bedId}`);
  await expect(drawer).toBeVisible({ timeout: 20_000 });
  await drawer.getByRole('button', { name: /Abrir explorador clínico de/ }).click();
  await expect(page.getByTestId('clinical-explorer')).toBeVisible({ timeout: 20_000 });
};

const screenshot = (page: Page, name: string) =>
  page.screenshot({
    path: process.env.CENSUS_VISUAL_OUTPUT_DIR
      ? `${process.env.CENSUS_VISUAL_OUTPUT_DIR}/${name}.png`
      : test.info().outputPath(`${name}.png`),
    animations: 'disabled',
    fullPage: true,
    mask: [page.getByRole('button', { name: /^Usuario / }).locator('..')],
  });

test('keeps the clinical explorer legible at 13-inch 100% and 125% and returns to the census', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await seedVisualCensus(page, { includeClinicalDetails: true, extraVitalReadings: true });
  await page.route('**/.netlify/functions/mmrad-search?*', route =>
    route.fulfill({
      json: {
        rut: '12345678-5',
        examenes: [
          {
            nombre_examen: 'Rx tórax sintética',
            fecha_examen: '03/04/2026 09:40',
            fecha_asignacion: '03/04/2026',
            mod: 'CR',
            estado: 'Validado',
            pdf_url: null,
            dicom_url: null,
            informe_html_url: null,
            report: null,
            registered_patient_id: '12345678-9',
            registered_patient_name: 'PACIENTE SINTÉTICO',
          },
          {
            nombre_examen: 'TC sintética de tórax, abdomen y pelvis con contraste',
            fecha_examen: '03/04/2026 08:20',
            fecha_asignacion: '03/04/2026',
            mod: 'CT',
            estado: 'Validado',
            pdf_url: 'https://mmrad.example/pdf/synthetic',
            dicom_url: 'https://mmrad.example/dicom/synthetic',
            informe_html_url: null,
            report: null,
          },
          {
            nombre_examen: 'Rx abdomen sintética',
            fecha_examen: '02/04/2026 17:05',
            fecha_asignacion: '02/04/2026',
            mod: 'CR',
            estado: 'Validado',
            pdf_url: null,
            dicom_url: 'https://mmrad.example/dicom/synthetic-rx',
            informe_html_url: null,
            report: null,
          },
        ],
      },
    })
  );
  await page.addInitScript(panel => {
    window.addEventListener('message', event => {
      const request = event.data;
      if (request?.type !== 'HHR_RAYEN_CLINICAL_PANEL_REQUEST' || !request.reqId) return;
      window.postMessage(
        { ...panel, type: 'HHR_RAYEN_CLINICAL_PANEL_RESULT', reqId: request.reqId },
        window.location.origin
      );
    });
  }, panelResult);
  await page.goto(`/?date=${DATE}`);
  await page.addStyleTag({ content: 'html { scroll-behavior: auto !important; }' });
  const row = page.locator('[data-testid="patient-row"][data-bed-id="R1"]');
  await expect(row).toContainText(PATIENT, { timeout: 20_000 });

  await openExplorerFromBed(page, 'R1');
  const explorer = page.getByTestId('clinical-explorer');
  const header = page.getByTestId('clinical-explorer-patient');
  await expect(header).toContainText(PATIENT);
  await expect(header).toContainText(`Censo ${DATE.split('-').reverse().join('-')}`);
  await expect(page.locator('.hhr-date-strip')).toBeHidden();
  const notes = page.getByRole('region', { name: 'Evoluciones' });
  await expect(notes.getByText('Entrega enfermería: sin novedades.')).toBeVisible();
  await expect(notes.getByText('Evolución médica estable.')).toHaveCount(0);
  await notes
    .getByRole('button', { name: /Mostrar evolución de/ })
    .last()
    .click();
  await expect(notes.getByText('Evolución médica estable.')).toBeVisible();
  await notes.getByRole('button', { name: /Ocultar evolución de Médico/ }).click();
  await expect(notes.getByText('Evolución médica estable.')).toHaveCount(0);
  const indications = page.getByRole('region', { name: 'Indicaciones' });
  const dateControl = indications.getByLabel('Fecha de indicaciones');
  await expect(indications.getByText('Mostrar indicaciones', { exact: true })).toBeVisible();
  await expect(dateControl).toBeHidden();
  await indications.getByText('Mostrar indicaciones', { exact: true }).click();
  await expect(dateControl).toBeVisible();
  await dateControl.fill('2026-07-13');
  await indications.getByText('Ocultar indicaciones', { exact: true }).click();
  await expect(indications.getByText('13-07-2026', { exact: true })).toBeVisible();
  await page.getByRole('tab', { name: 'Laboratorio', exact: true }).click();
  await page.getByRole('tab', { name: 'Indicaciones', exact: true }).click();
  await expect(dateControl).toHaveValue('2026-07-13');
  await expect(dateControl).toBeVisible();
  await page.getByRole('tab', { name: 'Vista conjunta', exact: true }).click();
  await expect(dateControl).toBeHidden();
  await expect(indications.getByText('13-07-2026', { exact: true })).toBeVisible();

  // The census stays mounted but out of sight: coming back is instant and loses nothing.
  await expect(page.locator('.census-register')).toBeHidden();

  for (const [zoom, width, height] of [
    ['100', 1280, 832],
    ['125', 1024, 666],
  ] as const) {
    await page.setViewportSize({ width, height });
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
    await expect(header).toContainText(PATIENT);

    const readingHeader = page.getByTestId('clinical-explorer-reading-header');
    await page.evaluate(() => window.scrollTo({ top: 400, behavior: 'instant' }));
    await expect(readingHeader).toBeVisible();
    const pinned = await readingHeader.boundingBox();
    const navbar = await page.locator('.hhr-navbar').boundingBox();
    expect(Math.abs(pinned!.y - (navbar!.y + navbar!.height))).toBeLessThanOrEqual(2);
    await page.getByRole('button', { name: 'Más acciones del paciente' }).click();
    await expect(page.getByRole('button', { name: 'Informes locales', exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(explorer).toBeVisible();
    await expect(page.getByRole('button', { name: 'Informes locales', exact: true })).toBeHidden();
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
    const imaging = page.getByRole('region', { name: 'Imágenes' });
    await expect(imaging.getByTestId('clinical-imaging-date')).toHaveCount(3);
    for (const cell of ['clinical-imaging-date', 'clinical-imaging-actions']) {
      const bounds = await imaging.getByTestId(cell).evaluateAll(elements =>
        elements.map(element => {
          const rect = element.getBoundingClientRect();
          return { x: rect.x, width: rect.width };
        })
      );
      for (const rect of bounds.slice(1)) {
        expect(Math.abs(rect.x - bounds[0].x)).toBeLessThanOrEqual(1);
        expect(Math.abs(rect.width - bounds[0].width)).toBeLessThanOrEqual(1);
      }
    }
    await expect(imaging.getByRole('button', { name: 'Informe (PDF)' })).toBeVisible();
    for (const action of await imaging
      .getByTestId('clinical-imaging-actions')
      .getByRole('button')
      .all()) {
      expect((await action.boundingBox())!.height).toBeLessThanOrEqual(33);
    }

    // Nothing pushes the page sideways.
    const overflow = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 1);

    // Patient list beside the panel, both inside the viewport.
    const list = page.getByRole('complementary', { name: 'Pacientes del censo' });
    const listBounds = await list.boundingBox();
    const headerBounds = await header.boundingBox();
    const explorerBounds = await explorer.boundingBox();
    expect(listBounds).not.toBeNull();
    expect(headerBounds).not.toBeNull();
    expect(explorerBounds).not.toBeNull();
    expect(listBounds!.x + listBounds!.width).toBeLessThanOrEqual(headerBounds!.x + 1);
    expect(headerBounds!.width).toBeGreaterThanOrEqual(explorerBounds!.width * 0.6);
    expect(explorerBounds!.x + explorerBounds!.width).toBeLessThanOrEqual(width + 1);
    const backBounds = await page.getByRole('button', { name: 'Volver al censo' }).boundingBox();
    expect(Math.abs(headerBounds!.y - backBounds!.y)).toBeLessThanOrEqual(2);
    expect(listBounds!.height).toBeLessThan(240);
    // The patient header is two short lines; at 1280 the requests fit beside them.
    if (width === 1280) expect(headerBounds!.height).toBeLessThanOrEqual(80);

    // The five areas are announced by name; the tab strip keeps one row.
    const tabs = page.getByRole('tablist', { name: 'Áreas' });
    await expect(tabs.getByRole('tab')).toHaveCount(6);
    const tabBounds = await tabs.boundingBox();
    expect(tabBounds!.height).toBeLessThanOrEqual(40);
    for (const area of [
      'Evoluciones',
      'Signos vitales',
      'Laboratorio',
      'Imágenes',
      'Indicaciones',
    ]) {
      await expect(page.getByRole('region', { name: area })).toBeVisible();
    }

    const evolutionsBounds = await page.getByRole('region', { name: 'Evoluciones' }).boundingBox();
    const vitals = page.getByRole('region', { name: 'Signos vitales' });
    await expect(vitals).toContainText('130/82');
    const readings = vitals.getByRole('button', { name: /\. Ver historial$/ });
    await expect(readings).toHaveCount(7);
    const gridBounds = await readings.first().locator('..').boundingBox();
    expect(gridBounds).not.toBeNull();
    const readingBoxes = await readings.all();
    const rowTop = (await readingBoxes[0].boundingBox())!.y;
    for (const reading of readingBoxes) {
      const bounds = await reading.boundingBox();
      expect(Math.abs(bounds!.y - rowTop)).toBeLessThanOrEqual(1);
      expect(bounds!.x).toBeGreaterThanOrEqual(gridBounds!.x - 1);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(gridBounds!.x + gridBounds!.width + 1);
      await expect(reading).toBeVisible();
      const valueFits = await reading.evaluate(element => {
        const value = element.children[1]?.firstChild;
        if (!value) return false;
        const range = document.createRange();
        range.selectNode(value);
        const textBounds = range.getBoundingClientRect();
        const cellBounds = element.getBoundingClientRect();
        return textBounds.left >= cellBounds.left && textBounds.right <= cellBounds.right;
      });
      expect(valueFits).toBe(true);
    }
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
    ).toBe(true);
    const vitalsBounds = await vitals.boundingBox();
    if (width === 1280) {
      expect(vitalsBounds!.y).toBe(evolutionsBounds!.y);
      expect(vitalsBounds!.x).toBeGreaterThan(evolutionsBounds!.x);
    } else {
      expect(vitalsBounds!.y).toBeGreaterThan(evolutionsBounds!.y);
    }
    await expect(
      page
        .getByRole('region', { name: 'Explorador clínico', exact: true })
        .getByText('Experimental', { exact: true })
    ).toHaveCount(0);

    // Syslab is unavailable and MMRAD uses synthetic studies; neither is an empty hospitalization.
    await expect(page.getByRole('region', { name: 'Laboratorio' })).not.toContainText(
      'Sin informes de laboratorio'
    );
    await expect(page.getByRole('region', { name: 'Imágenes' })).not.toContainText(
      'Sin estudios de imágenes'
    );

    const identityNotice = page.getByRole('button', {
      name: 'Advertencia de identificación del estudio',
    });
    await expect(identityNotice).toBeVisible();
    await expect(page.getByRole('tooltip')).toHaveCount(0);
    await identityNotice.hover();
    const tooltip = page.getByRole('tooltip');
    await expect(tooltip).toContainText('confirma que es el mismo paciente');
    const tooltipBounds = await tooltip.boundingBox();
    expect(tooltipBounds!.x + tooltipBounds!.width).toBeLessThanOrEqual(width);
    await page.keyboard.press('Escape');
    await expect(tooltip).toHaveCount(0);
    await expect(explorer).toBeVisible();
    await header.getByRole('heading', { level: 2 }).click();
    await identityNotice.focus();
    await expect(tooltip).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(tooltip).toHaveCount(0);
    await page.mouse.move(1, 1);
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
    await screenshot(page, `clinical-explorer-${zoom}`);
  }

  const vitalsPanel = page.getByRole('region', { name: 'Signos vitales', exact: true });
  await expect(vitalsPanel).not.toContainText('Censo · Eloísa');
  await expect(vitalsPanel).not.toContainText('Última toma disponible');
  await expect(vitalsPanel).toContainText('1.700 ml');
  await expect(page.getByRole('region', { name: 'Alertas', exact: true })).toContainText(
    'Alerta clínica sintética'
  );
  await expect(header.getByRole('img', { name: 'Aislamiento: Contacto' })).toBeVisible();
  await header.getByRole('button', { name: 'Más acciones del paciente' }).click();
  await expect(header.getByRole('button', { name: 'Informes locales', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await vitalsPanel.getByRole('button', { name: 'Signos vitales', exact: true }).click();
  const vitalsDialog = page.getByRole('dialog', { name: /Signos vitales/ });
  await expect(vitalsDialog).toContainText('Historial · 2 tomas');
  await expect(vitalsDialog).toContainText('110/70');
  await page.keyboard.press('Escape');
  await expect(vitalsDialog).toHaveCount(0);

  // Another patient from the side list, and back with the keyboard.
  await page
    .getByRole('list', { name: 'Lista de pacientes' })
    .getByRole('button', { name: new RegExp(SECOND_PATIENT) })
    .click();
  await expect(header).toContainText(SECOND_PATIENT);
  await expect(
    page.getByText('Ingresos y diuresis sin datos sincronizados para este día.')
  ).toHaveCount(0);
  await expect(header.getByRole('img', { name: /Aislamiento/ })).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Alertas', exact: true })).not.toContainText(
    'Alerta clínica sintética'
  );
  await page.keyboard.press('ArrowLeft');
  await expect(header).toContainText(PATIENT);

  await page.setViewportSize({ width: 390, height: 844 });
  await screenshot(page, 'clinical-explorer-mobile');
  await expect(header).toContainText(PATIENT);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true
  );
  const indicationsTab = page.getByRole('tab', { name: 'Indicaciones', exact: true });
  await indicationsTab.scrollIntoViewIfNeeded();
  await indicationsTab.click();
  await expect(indicationsTab).toHaveAttribute('aria-selected', 'true');
  await page.setViewportSize({ width: 1024, height: 666 });

  // Back to the census: same day, same row, focus on the trigger that opened the explorer.
  await page.getByRole('button', { name: 'Volver al censo' }).click();
  await expect(page.getByTestId('clinical-explorer')).toHaveCount(0);
  await expect(page.locator('.census-register')).toBeVisible();
  await expect(page.locator('.hhr-date-strip')).toBeVisible();
  await expect(row).toContainText(PATIENT);
  await expect
    .poll(() =>
      page.evaluate(() =>
        document.activeElement?.closest('[data-testid="patient-row"]')?.getAttribute('data-bed-id')
      )
    )
    .toBe('R1');
});

test('prints the laboratory orders of several patients as one document, one page each', async ({
  page,
}) => {
  await seedVisualCensus(page);
  await page.goto(`/?date=${DATE}`);
  await expect(page.locator('[data-testid="patient-row"][data-bed-id="R1"]')).toContainText(
    PATIENT,
    { timeout: 20_000 }
  );
  await openExplorerFromBed(page, 'R1');

  await page.getByRole('button', { name: 'Exámenes', exact: true }).click();
  const dialog = page.getByTestId('exam-request-modal');
  await expect(dialog).toBeVisible({ timeout: 20_000 });
  await dialog.getByRole('button', { name: /Pacientes/ }).click();
  await dialog.getByRole('checkbox', { name: /R2/ }).check();
  const tabs = dialog.getByRole('tablist', { name: 'Pacientes de la solicitud' });
  await expect(tabs.getByRole('tab')).toHaveCount(2);
  await expect(tabs.getByRole('tab', { selected: true })).toContainText(SECOND_PATIENT);

  // On screen only the active order shows; the printed document carries both.
  const forms = dialog.getByTestId('exam-request-form');
  await expect(forms).toHaveCount(2);
  await expect(forms.nth(0)).toBeHidden();
  await page.emulateMedia({ media: 'print' });
  await expect(forms.nth(0)).toBeVisible();
  await expect(forms.nth(1)).toBeVisible();

  const pdf = await page.pdf({ format: 'Letter', printBackground: true });
  const pages = pdf.toString('latin1').match(/\/Type\s*\/Page(?!s)/g) ?? [];
  expect(pages).toHaveLength(2);
  if (process.env.CENSUS_VISUAL_OUTPUT_DIR) {
    writeFileSync(`${process.env.CENSUS_VISUAL_OUTPUT_DIR}/exam-orders-two-patients.pdf`, pdf);
  }
});

test('compares compact original laboratory reports on desktop and opens the exact PDF', async ({
  page,
}) => {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  const trendRequests: string[] = [];
  page.on('console', message => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('request', request => {
    if (/ClinicalExplorerLabTrends-[^/]+\.js/.test(request.url()))
      trendRequests.push(request.url());
  });
  page.on('pageerror', error => pageErrors.push(error.message));
  await seedVisualCensus(page);
  // The synthetic census has no exported files in Storage.
  await page.route(
    'https://firebasestorage.googleapis.com/v0/b/demo-hhr-e2e.firebasestorage.app/o?*',
    route =>
      route.fulfill({
        json: { prefixes: [], items: [] },
        headers: {
          'access-control-allow-origin': '*',
          'access-control-allow-headers': 'authorization, *',
          'access-control-allow-methods': 'GET, OPTIONS',
        },
      })
  );
  await page.route('**/.netlify/functions/mmrad-search?*', route =>
    route.fulfill({ json: { rut: '12345678-5', examenes: [] } })
  );
  await page.addInitScript(panel => {
    const dates = [
      '29/03/2026',
      '30/03/2026',
      '31/03/2026',
      '01/04/2026',
      '02/04/2026',
      '03/04/2026',
      '03/04/2026',
      '03/04/2026',
      '03/04/2026',
      '03/04/2026',
      '03/04/2026',
    ];
    const exams = dates.map((date, index) => ({
      id: String(100 + index),
      date,
      time: index === 6 ? '10:00:59' : '10:00:00',
      patientName: 'PACIENTE SINTÉTICO',
      origin: 'HOSP',
      exams: ['HEMOGRAMA', 'BIOQUIMICA'],
    }));
    window.addEventListener('message', event => {
      const request = event.data;
      if (!request?.reqId) return;
      if (request.type === 'HHR_RAYEN_CLINICAL_PANEL_REQUEST') {
        window.postMessage(
          { ...panel, type: 'HHR_RAYEN_CLINICAL_PANEL_RESULT', reqId: request.reqId },
          window.location.origin
        );
        return;
      }
      const responses: Record<string, object> = {
        HHR_RAYEN_SYSLAB_STATUS_REQUEST: { ok: true, connected: true },
        HHR_RAYEN_SYSLAB_SEARCH_REQUEST: {
          ok: true,
          batchId: '00000000-0000-4000-8000-000000000001',
          rutBody: request.rutBody,
          exams,
        },
        HHR_RAYEN_SYSLAB_DETAILS_REQUEST: {
          ok: true,
          analysis: {
            reports: exams
              .map((exam, index) => ({
                examId: exam.id,
                findings: [
                  {
                    section: 'BIOQUIMICA',
                    analysis: 'Creatinina',
                    result: `1,${index}`,
                    unit: 'mg/dL',
                    refValue: '0,7 - 1,2',
                  },
                  ...(index === 6
                    ? [
                        {
                          section: 'HEMOGRAMA',
                          analysis: 'Hemoglobina',
                          result: '12,0',
                          unit: 'g/dL',
                          refValue: '12 - 16',
                        },
                      ]
                    : []),
                ],
              }))
              .filter(report =>
                request.links?.some((link: string) => link.endsWith(`/exam/${report.examId}`))
              ),
          },
        },
        HHR_RAYEN_SYSLAB_PDF_REQUEST: { ok: true },
      };
      const response = responses[request.type];
      if (response) {
        if (request.type === 'HHR_RAYEN_SYSLAB_PDF_REQUEST')
          document.documentElement.dataset.openedLabPdf = request.link;
        window.postMessage(
          { type: request.type.replace(/_REQUEST$/, '_RESULT'), reqId: request.reqId, response },
          window.location.origin
        );
      }
    });
  }, panelResult);
  await page.goto(`/?date=${DATE}`);
  await expect(page).toHaveTitle(/HHR/);
  await expect(page).toHaveURL(/\/census\?date=/);
  await expect(page.locator('[data-testid="patient-row"][data-bed-id="R1"]')).toContainText(
    PATIENT,
    { timeout: 20_000 }
  );
  await openExplorerFromBed(page, 'R1');
  await page.setViewportSize({ width: 1440, height: 1000 });
  await expect(page.getByRole('table', { name: /Últimos 10 informes/ })).toBeVisible({
    timeout: 20_000,
  });
  await screenshot(page, 'clinical-explorer-overview-1440');
  await page.getByRole('tab', { name: 'Laboratorio', exact: true }).click();
  const table = page.getByRole('table', { name: /Últimos 10 informes/ });
  await expect(table).toBeVisible({ timeout: 20_000 });
  await expect(table.getByRole('button', { name: /Abrir PDF/ })).toHaveCount(10);
  await expect(table).toContainText('10:00');
  await expect(table).not.toContainText('10:00:59');
  await expect(table).not.toContainText('Ref.');
  await expect(table).not.toContainText('Hemograma');
  await expect(table).not.toContainText('Función renal / electrolitos');
  await expect(page.getByText('valores sin interpretar')).toHaveCount(0);
  const trends = page.getByRole('button', { name: 'Tendencias', exact: true });
  await expect(trends).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByRole('img', { name: /Creatinina/ })).toHaveCount(0);
  expect(trendRequests).toEqual([]);
  const search = page.getByRole('searchbox', { name: 'Buscar examen de laboratorio' });
  await search.fill('CREATINÍNA');
  await expect(table).not.toContainText('Hemoglobina');
  await expect(table).toContainText('Creatinina');
  await search.fill('sin coincidencias');
  await expect(table.getByRole('status')).toContainText('Sin exámenes que coincidan');
  await page.getByRole('button', { name: 'Limpiar búsqueda de exámenes' }).click();
  await expect(page.getByRole('complementary', { name: 'Pacientes del censo' })).not.toContainText(
    '12345678'
  );
  const haemoglobin = table.getByRole('row', { name: /Hemoglobina/ });
  await expect(haemoglobin.getByRole('cell')).toHaveText([
    '12,0',
    '—',
    '—',
    '—',
    '—',
    '—',
    '—',
    '—',
    '—',
    '—',
  ]);
  const compactRowBounds = await table.getByRole('row', { name: /Creatinina/ }).boundingBox();
  expect(compactRowBounds!.height).toBeLessThanOrEqual(30);
  for (const width of [1440, 1024]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(page.locator('vite-error-overlay')).toHaveCount(0);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
    ).toBe(true);
    await table.scrollIntoViewIfNeeded();
    await screenshot(page, `clinical-explorer-laboratory-${width}`);
  }
  await trends.click();
  await expect(page.getByRole('img', { name: /Creatinina/ })).toBeVisible();
  expect(trendRequests).toHaveLength(1);
  await screenshot(page, 'clinical-explorer-trends-open-1024');
  await trends.click();
  await expect(page.getByRole('img', { name: /Creatinina/ })).toHaveCount(0);
  await trends.click();
  await expect(page.getByRole('img', { name: /Creatinina/ })).toBeVisible();
  expect(trendRequests).toHaveLength(1);
  await trends.click();
  expect(consoleErrors).toEqual([]);
  await table.getByRole('button', { name: 'Abrir PDF del informe 105 del 03-04-2026' }).click();
  await expect(page.getByRole('dialog')).toContainText('El informe se abrió en una pestaña segura');
  await expect(page.locator('html')).toHaveAttribute('data-opened-lab-pdf', /\/exam\/105$/);
  expect(pageErrors).toEqual([]);
  await page.route('**/assets/ClinicalExplorerLabTrends-*.js', route => route.abort());
  await page.reload();
  await expect(page.locator('[data-testid="patient-row"][data-bed-id="R1"]')).toContainText(
    PATIENT,
    { timeout: 20_000 }
  );
  await openExplorerFromBed(page, 'R1');
  await page.getByRole('tab', { name: 'Laboratorio', exact: true }).click();
  await page.getByRole('button', { name: 'Tendencias', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Laboratorio' }).getByRole('alert')).toContainText(
    'No se pudo cargar esta sección'
  );
  await expect(page.getByRole('table', { name: /Últimos 10 informes/ })).toBeVisible();
  await page.getByRole('searchbox', { name: 'Buscar examen de laboratorio' }).fill('creatinina');
  await expect(page.getByRole('table')).not.toContainText('Hemoglobina');
  await page.getByRole('button', { name: 'Volver al censo' }).click();
  await expect(page.locator('.census-register')).toBeVisible();
});
