import { utils, write } from 'xlsx';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import ExcelJS from 'exceljs';
import { buildCanonicalE2ERecord, ensureAuthenticated } from './fixtures/auth';
import {
  DATE,
  hospital,
  episode,
  patient,
  seedHospitalAdmissions,
  db,
  open,
  screenshot,
} from './fixtures/cudyrReport';
const { Workbook } = ExcelJS;

test('supports a narrow viewport, detail focus and bounded table scrolling', async ({ page }) => {
  test.setTimeout(90000);
  await page.setViewportSize({ width: 390, height: 844 });
  const { calls, errors } = await open(page);
  await page
    .getByRole('button', { name: 'Ver detalle de PACIENTE SINTÉTICO R1 del ' + DATE })
    .click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await screenshot(page, 'cudyr-detalle-movil');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.evaluate(() => window.scrollTo(0, 0));
  await screenshot(page, 'cudyr-explorador-movil');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(calls.filter(call => call === 'archiveCudyrHistory')).toHaveLength(0);
  expect(errors).toEqual([]);
});

test('imports monthly XLS as passive evidence, persists it and exports it without changing the main report', async ({
  page,
}) => {
  test.setTimeout(120000);
  const { calls, errors } = await open(page);
  const totals = page.getByRole('region', { name: 'Totales de la vista filtrada' });
  const before = await totals.textContent();
  const panel = page.getByTestId('cudyr-supplement-panel');
  await expect(panel).not.toHaveAttribute('open');
  await panel.locator('summary').click();
  const book = utils.book_new();
  const patientRow: unknown[] = [
    1,
    'Paciente Sintético fuente',
    'FICHA-TEST',
    '11.111.111-1',
    'Diagnóstico fuente',
    3,
    'MQ',
    'Vivo',
  ];
  patientRow[8 + 19] = 'C3';
  utils.book_append_sheet(
    book,
    utils.aoa_to_sheet([
      ['MINISTERIO DE SALUD', 'Fecha Hora Impresión: 21-02-2026 02:35'],
      ['Hospital Hanga Roa (Isla De Pascua)', 'Categorización Riesgo Dependencia'],
      ['Mes consultado: Febrero de 2026'],
      [
        'N°',
        'Nombre Paciente',
        'Ficha Clínica',
        'RUN o Nro. Ident.',
        'Diagnóstico de Ingreso',
        'Días Hosp.',
        'Servicio Clínico',
        'Condición Alta',
        ...Array.from({ length: 31 }, (_, i) => `Día ${i + 1}`),
      ],
      patientRow,
    ]),
    'Synthetic'
  );
  const buffer = write(book, { type: 'buffer', bookType: 'biff8' });
  await page.getByLabel('Agregar informe mensual de Eloísa').setInputFiles({
    name: 'respaldo-sintetico.xls',
    mimeType: 'application/vnd.ms-excel',
    buffer,
  });
  await expect(page.getByRole('button', { name: 'Guardar respaldo' })).toBeDisabled({
    timeout: 15_000,
  });
  await expect(panel).toContainText('1 celdas con categoría');
  await panel.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Guardar respaldo' }).click();
  await expect(panel).toContainText('Respaldo guardado.');
  await expect(panel).toContainText('2026-02-20: C3');
  expect(await totals.textContent()).toBe(before);
  await page
    .getByRole('button', { name: 'Ver detalle de PACIENTE SINTÉTICO R1 del ' + DATE })
    .click();
  await page
    .getByRole('dialog')
    .getByText('Evidencia del informe mensual (1 coincidencias)', { exact: true })
    .click();
  await expect(page.getByRole('dialog')).toContainText('2026-02-20: C3');
  await expect(page.getByRole('dialog')).toContainText('AUTORA SINTÉTICA');
  await screenshot(page, 'cudyr-complemento-detalle');
  await page.keyboard.press('Escape');
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Excel para Estadística' }).click();
  const download = await downloaded;
  const workbook = new Workbook();
  await workbook.xlsx.readFile((await download.path())!);
  expect(workbook.getWorksheet('20-02-2026')!.getCell('B11').value).toBe(1);
  expect(workbook.getWorksheet('Respaldo mensual Eloísa')!.getCell('I2').value).toBe('C3');
  expect(workbook.getWorksheet('Detalle diario')!.rowCount).toBe(5);
  expect(workbook.getWorksheet('Detalle diario')!.columnCount).toBe(30);
  expect(workbook.getWorksheet('Capturas')).toBeUndefined();
  expect(download.suggestedFilename()).toContain('CUDYR_Estadistica_');
  if (process.env.CUDYR_QA_OUTPUT)
    await download.saveAs(
      path.join(process.env.CUDYR_QA_OUTPUT, 'CUDYR_Estadistica_EJEMPLO_SINTETICO.xlsx')
    );
  const auditEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Excel de auditoría' }).click();
  const auditDownload = await auditEvent;
  const audit = new Workbook();
  await audit.xlsx.readFile((await auditDownload.path())!);
  expect(auditDownload.suggestedFilename()).toContain('CUDYR_Auditoria_');
  expect(audit.getWorksheet('Detalle diario')!.columnCount).toBe(54);
  expect(audit.getWorksheet('Capturas')).toBeDefined();
  expect(audit.getWorksheet('20-02-2026')!.getSheetValues()).toEqual(
    workbook.getWorksheet('20-02-2026')!.getSheetValues()
  );
  if (process.env.CUDYR_QA_OUTPUT)
    await auditDownload.saveAs(
      path.join(process.env.CUDYR_QA_OUTPUT, 'CUDYR_Auditoria_EJEMPLO_SINTETICO.xlsx')
    );
  await screenshot(page, 'cudyr-complemento-escritorio');
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await screenshot(page, 'cudyr-complemento-movil');
  expect((await db.collection(hospital + '/cudyrMonthlySupplements').get()).size).toBe(1);
  expect((await db.doc(hospital + '/dailyRecords/' + DATE).get()).data()?.discharges).toEqual([]);
  expect(calls.filter(c => c === 'archiveCudyrHistory')).toHaveLength(1);
  expect(errors).toEqual([]);
});

test('reconciles local sources and saves only documentary review without changing the census', async ({
  page,
}) => {
  const { reconciliationUpload } = await import('./fixtures/cudyrReconciliation');
  const { calls, errors } = await open(page);
  const original = (await db.doc(hospital + '/dailyRecords/' + DATE).get()).data();
  const totals = page.getByRole('region', { name: 'Totales de la vista filtrada' });
  const before = await totals.textContent();
  const panel = page.getByTestId('cudyr-monthly-reconciliation');
  await expect(panel).not.toHaveAttribute('open');
  await panel.locator('summary').first().click();
  await panel
    .getByLabel('Categorización Eloísa local')
    .setInputFiles(reconciliationUpload('categories'));
  await expect(panel.getByRole('article').filter({ hasText: 'Categoría diferente' })).toHaveCount(
    1
  );
  await panel
    .getByLabel('Altas administrativas locales')
    .setInputFiles(reconciliationUpload('discharges'));
  await expect(panel.getByRole('article').filter({ hasText: 'Alta por cotejar' })).toHaveCount(1);
  await panel
    .getByRole('article')
    .filter({ hasText: 'Categoría diferente' })
    .locator('summary')
    .first()
    .click();
  await expect(panel).toContainText('AUTORA SINTÉTICA');
  await expect(panel).toContainText('Censo 2026-02-20');
  expect(await totals.textContent()).toBe(before);
  expect(calls.filter(c => c === 'archiveCudyrHistory')).toHaveLength(0);
  expect((await db.doc(hospital + '/dailyRecords/' + DATE).get()).data()).toEqual(original);
  const review = panel.getByRole('article').filter({ hasText: 'Categoría diferente' });
  await review.getByText('Revisar y guardar').click();
  await review.getByLabel('Decisión de revisión').selectOption('link');
  await review.getByLabel('Episodio HHR a revisar').selectOption({ index: 1 });
  await review
    .getByLabel('Motivo y respaldo de la revisión')
    .fill('Episodio cotejado con evidencia sintética de la ficha.');
  await review.getByRole('checkbox').check();
  await review.getByRole('button', { name: 'Guardar revisión en HHR' }).click();
  await expect(review).toContainText('Revisión guardada');
  expect(await totals.textContent()).toBe(before);
  expect(calls.filter(c => c === 'archiveCudyrHistory')).toHaveLength(1);
  expect((await db.doc(hospital + '/dailyRecords/' + DATE).get()).data()).toEqual(original);
  await screenshot(page, 'cudyr-conciliacion-escritorio');
  await page.setViewportSize({ width: 390, height: 844 });
  await panel.scrollIntoViewIfNeeded();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await screenshot(page, 'cudyr-conciliacion-movil');
  await review.locator('details').last().scrollIntoViewIfNeeded();
  await screenshot(page, 'cudyr-vinculo-movil');
  await page.getByLabel('Desde', { exact: true }).fill('2026-02-19');
  await page.getByRole('button', { name: 'Consultar período' }).click();
  await expect(page.getByRole('button', { name: 'Consultar período' })).toBeEnabled();
  await panel.locator('summary').first().click();
  await expect(panel.getByRole('button', { name: 'Quitar de la comparación' })).toHaveCount(0);
  await expect(panel).toContainText('1 decisiones guardadas fuera');
  await expect(panel).not.toContainText('1 decisiones en borrador');
  expect(errors).toEqual([]);
});

test('resumes a saved July review after leaving and preserves its audit trail', async ({
  page,
}) => {
  const { reconciliationUpload } = await import('./fixtures/cudyrReconciliation');
  const { errors } = await open(page);
  const original = (await db.doc(hospital + '/dailyRecords/' + DATE).get()).data();
  await page.getByLabel('Desde', { exact: true }).fill('2026-07-01');
  await page.getByLabel('Hasta', { exact: true }).fill('2026-07-31');
  await page.getByRole('button', { name: 'Consultar período' }).click();
  await expect(page.getByRole('button', { name: 'Consultar período' })).toBeEnabled();
  const panel = page.getByTestId('cudyr-monthly-reconciliation');
  await panel.locator('summary').first().click();
  await panel
    .getByLabel('Categorización Eloísa local')
    .setInputFiles(reconciliationUpload('categories', true));
  const row = panel.getByRole('article').filter({ hasText: 'PACIENTE SINTÉTICO R1' });
  await row.getByText('Revisar y guardar').click();
  await row
    .getByLabel('Motivo y respaldo de la revisión')
    .fill('Pendiente cotejar episodio cerrado de julio con su ficha original.');
  await row.getByRole('button', { name: 'Guardar revisión en HHR' }).click();
  await expect(row).toContainText('Revisión guardada');
  await page.getByRole('button', { name: 'Consultar período' }).click();
  await expect(page.getByRole('button', { name: 'Consultar período' })).toBeEnabled();
  await panel.locator('summary').first().click();
  await expect(panel).toContainText('1 decisiones guardadas fuera');
  await panel.getByRole('button', { name: 'Continuar revisión de 2026-07' }).click();
  await expect(panel).toContainText('Falta adjuntar el archivo original:');
  await panel
    .getByLabel('Categorización Eloísa local')
    .setInputFiles(reconciliationUpload('categories', true));
  await expect(row).toContainText('Revisión guardada');
  await expect(row).toContainText('Pendiente cotejar episodio cerrado de julio');
  await expect(panel).not.toContainText('Falta adjuntar el archivo original:');
  await expect(row).toContainText('hora de Rapa Nui');
  await row.getByText('Historial de revisiones').click();
  await row.getByRole('button', { name: 'Consultar versiones guardadas' }).click();
  await expect(row).toContainText('Versión 1');
  await page.setViewportSize({ width: 390, height: 844 });
  await panel.scrollIntoViewIfNeeded();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await screenshot(page, 'cudyr-revision-guardada-movil');
  expect((await db.doc(hospital + '/dailyRecords/' + DATE).get()).data()).toEqual(original);
  expect(errors).toEqual([]);
});

test('prepares a bounded recovery list without querying Eloisa or changing statistics', async ({
  page,
}) => {
  const { calls, errors } = await open(page);
  const totals = page.getByRole('region', { name: 'Totales de la vista filtrada' });
  const before = await totals.textContent();
  const original = (await db.doc(hospital + '/dailyRecords/' + DATE).get()).data();
  const panel = page.getByTestId('cudyr-monthly-reconciliation');
  await panel.locator('summary').first().click();
  const recovery = page.getByTestId('cudyr-recovery-plan');
  await expect(recovery).not.toHaveAttribute('open');
  await recovery.locator('summary').first().click();
  await expect(recovery).toContainText('Buscar evaluación no observada');
  await expect(recovery.getByRole('article')).toHaveCount(1);
  await recovery.getByRole('checkbox').check();
  const downloaded = page.waitForEvent('download');
  await recovery.getByRole('button', { name: 'Descargar lista de búsqueda (1/20)' }).click();
  const download = await downloaded;
  const workbook = new Workbook();
  await workbook.xlsx.readFile((await download.path())!);
  expect(workbook.getWorksheet('Búsqueda dirigida')!.rowCount).toBe(2);
  expect(workbook.getWorksheet('Búsqueda dirigida')!.getCell('A2').value).toBe(
    'PACIENTE SINTÉTICO NEO1'
  );
  expect(workbook.getWorksheet('Búsqueda dirigida')!.getCell('F2').value).toBe('Media');
  expect(download.suggestedFilename()).toContain('CUDYR_Busqueda_');
  expect(await totals.textContent()).toBe(before);
  expect(calls.filter(c => c === 'archiveCudyrHistory')).toHaveLength(0);
  expect((await db.doc(hospital + '/dailyRecords/' + DATE).get()).data()).toEqual(original);
  await page.setViewportSize({ width: 390, height: 844 });
  await recovery.scrollIntoViewIfNeeded();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await screenshot(page, 'cudyr-busqueda-dirigida-movil');
  expect(errors).toEqual([]);
});

// Replaces the retired batch-entry screen: CUDYR values are now read-only in this view.
test('reviews a daily exclusion, persists it after reload and retains it outside Excel compliance', async ({
  page,
}) => {
  test.setTimeout(90000);
  const { errors } = await open(page, 'admin', true);
  await expect(page.getByRole('heading', { name: 'CUDYR · control diario' })).toBeVisible();
  await expect(
    page.getByRole('button', { name: /Guardar CUDYR|Eliminar varios resultados/ })
  ).toHaveCount(0);
  await page
    .getByRole('button', { name: /(?:Agregar|Editar) excepción manual de PACIENTE SINTÉTICO R1$/ })
    .click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: 'Excepción CUDYR' })).toBeVisible();
  await expect(dialog.getByText(/Última consulta:/)).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: 'Guardar excepción' })).toBeVisible();
  await screenshot(page, 'cudyr-excepcion-compacta');
  await dialog.getByRole('button', { name: 'Información del caso' }).click();
  await expect(dialog.getByText(/Última consulta:/)).toBeVisible();
  await dialog.getByRole('button', { name: 'Información del caso' }).click();
  await expect(dialog.getByText(/Última consulta:/)).toHaveCount(0);
  await dialog.getByLabel('Motivo de exclusión').selectOption('not_hospitalized');
  await dialog
    .getByLabel('Observación breve')
    .fill('Salida física verificada para este día; pendiente de regularización.');
  await dialog.getByRole('checkbox').check();
  await dialog.getByRole('button', { name: 'Guardar excepción' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(
    page.getByRole('button', {
      name: /(?:Agregar|Editar) excepción manual de PACIENTE SINTÉTICO R1$/,
    })
  ).toHaveCount(1);
  // Full navigation reloads the app and explicitly reopens the reviewed day.
  await page.goto('/cudyr?date=' + DATE);
  await ensureAuthenticated(page);
  await page.getByRole('combobox').selectOption('no_elegible');
  await page
    .getByRole('button', { name: /(?:Agregar|Editar) excepción manual de PACIENTE SINTÉTICO R1$/ })
    .click();
  await page.getByRole('dialog').getByRole('button', { name: 'Información del caso' }).click();
  await expect(page.getByRole('dialog')).toContainText('Decisión manual');
  await page.keyboard.press('Escape');
  await screenshot(page, 'cudyr-control-diario');
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true
  );
  await screenshot(page, 'cudyr-control-diario-movil');
  await page.setViewportSize({ width: 1280, height: 900 });
  const event = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Excel mensual', exact: true }).click();
  const file = await (await event).path();
  const book = new Workbook();
  await book.xlsx.readFile(file!);
  expect(book.worksheets[0].name).toBe('Resumen CUDYR Mensual');
  const detail = book.getWorksheet('20-02-2026')!;
  const patientRows = detail.getRows(25, 4)!;
  expect(patientRows.map(row => row.getCell(3).value)).toEqual(
    expect.arrayContaining(['PACIENTE SINTÉTICO NEO1', 'PACIENTE SINTÉTICO R1'])
  );
  const excluded = patientRows.find(row => row.getCell(3).value === 'PACIENTE SINTÉTICO R1')!;
  const headers = detail.getRow(24).values as ExcelJS.CellValue[];
  const eligibilityColumn = headers.indexOf('Elegibilidad');
  expect(eligibilityColumn).toBeGreaterThan(0);
  expect(excluded.getCell(eligibilityColumn).value).toBe('No elegible');
  expect(detail.getCell('B19').value).toBe(1);
  expect(detail.getCell('B20').value).toBe(0); // The remaining eligible case has no confirmed CUDYR.
  expect(errors).toEqual([]);
});

test('fits eighteen eligible patients in a compact desktop table with daily compliance', async ({
  page,
}) => {
  const { calls, errors } = await open(page, 'admin', true);
  const beds = [
    'R1',
    'R2',
    'R3',
    'R4',
    'NEO1',
    'NEO2',
    ...Array.from({ length: 6 }, (_, i) => [`H${i + 1}C1`, `H${i + 1}C2`]).flat(),
  ];
  const full = buildCanonicalE2ERecord(DATE, {
    beds: Object.fromEntries(
      beds.map(id => [id, patient(id, id === 'R1' ? episode : 'synthetic-' + id)])
    ),
    discharges: [],
    transfers: [],
    cma: [],
  });
  await db.doc(hospital + '/dailyRecords/' + DATE).set(full);
  await seedHospitalAdmissions(full.beds);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole('button', { name: 'Actualizar vista' }).click();
  await expect(page.getByRole('button', { name: /excepción manual de/ })).toHaveCount(18);
  await expect(page.getByText('Cumplimiento del día', { exact: true })).toBeVisible();
  await expect(page.getByRole('columnheader', { name: 'Ingreso hosp.' })).toBeVisible();
  await expect(page.getByRole('columnheader', { name: 'Captura Eloísa' })).toHaveCount(0);
  await expect(page.getByRole('cell', { name: 'R1 Hospitalizados', exact: true })).toBeVisible();
  await expect(page.getByRole('columnheader', { name: 'Registro CUDYR' })).toBeVisible();
  await page.getByRole('button', { name: 'jueves, 19 de febrero de 2026', exact: true }).click();
  await expect(page.getByText('Turno noche 19-02-2026 · Horario de Rapa Nui')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Actualizar vista' })).toBeEnabled();
  const readsBeforeReturn = calls.filter(call => call === 'readCudyrHistory').length;
  await page.getByRole('button', { name: 'viernes, 20 de febrero de 2026', exact: true }).click();
  await expect(page.getByRole('button', { name: /excepción manual de/ })).toHaveCount(18);
  expect(calls.filter(call => call === 'readCudyrHistory').length).toBe(readsBeforeReturn);
  const bounds = await page.getByRole('table').boundingBox();
  expect(bounds!.height).toBeLessThan(620);
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(1000);
  await screenshot(page, 'cudyr-compacto-18-pacientes');
  const readsBeforeMovements = calls.filter(call => call === 'readCudyrHistory').length;
  await page
    .getByRole('button', { name: 'Movimientos de PACIENTE SINTÉTICO R1', exact: true })
    .click();
  await expect(page.getByRole('dialog')).toContainText(
    'Primer ingreso registrado a Hospitalizados'
  );
  await expect(
    page.getByRole('dialog').getByRole('cell', { name: 'R1 Hospitalizados' })
  ).toBeVisible();
  await screenshot(page, 'cudyr-movimientos-camas');
  await page.keyboard.press('Escape');
  expect(calls.filter(call => call === 'readCudyrHistory').length).toBe(readsBeforeMovements);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await screenshot(page, 'cudyr-compacto-movil');
  expect(errors).toEqual([]);
});

test('shows first hospital bed entry even when episode time differs and both assignments have no closure', async ({
  page,
}) => {
  const { errors } = await open(page, 'admin', true);
  const ref = db.doc(hospital + '/cudyrCaptures/admission-' + episode);
  const receipt = (await ref.get()).data()!;
  const base = receipt.capture.sourcePlacements[0];
  await ref.update({
    'capture.sourcePlacements': [
      {
        ...base,
        sourceMappingId: 'first-bed',
        bedId: 'H1C1',
        sourceBedId: 'H1C1',
        sourceBedLabel: 'H1C1',
        sourceStartAt: DATE + 'T16:17:30-05:00',
      },
      {
        ...base,
        sourceMappingId: 'second-bed',
        bedId: 'H6C2',
        sourceBedId: 'H6C2',
        sourceBedLabel: 'H6C2',
        sourceStartAt: DATE + 'T20:41:08-05:00',
      },
    ],
  });
  await page.getByRole('button', { name: 'Actualizar vista' }).click();
  const row = page.getByRole('row').filter({ hasText: 'PACIENTE SINTÉTICO R1' });
  await expect(row.getByText(/16:17/)).toBeVisible();
  await page
    .getByRole('button', { name: 'Movimientos de PACIENTE SINTÉTICO R1', exact: true })
    .click();
  await expect(page.getByRole('dialog')).toContainText(
    'Primera'.toLowerCase() + ' asignación registrada'
  );
  await expect(page.getByRole('dialog').getByText('Por confirmar', { exact: true })).toHaveCount(0);
  await screenshot(page, 'cudyr-primer-ingreso-corregido');
  expect(errors).toEqual([]);
});
