import { expect, test } from '@playwright/test';
import ExcelJS from 'exceljs';
import path from 'node:path';
import { DATE, hospital, db, open, screenshot } from './fixtures/cudyrReport';
const { Workbook } = ExcelJS;

test('reuses the verified period when returning from the explorer without changes', async ({
  page,
}) => {
  test.setTimeout(90000);
  const { requests, errors } = await open(page, 'admin', true);
  await expect(page.getByRole('button', { name: 'Excel mensual', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Explorar reporte estadístico' }).click();
  await expect(page.getByRole('button', { name: 'Excel para Estadística' })).toBeEnabled();
  const reads = () => requests.filter(request => request.endpoint === 'readCudyrHistory').length;
  const beforeReturn = reads();
  await page.getByRole('button', { name: 'Volver al registro CUDYR' }).click();
  await expect(page.getByRole('heading', { name: 'CUDYR · control diario' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Excel mensual', exact: true })).toBeEnabled();
  await expect(page.getByText('PACIENTE SINTÉTICO R1', { exact: true })).toBeVisible();
  expect(reads()).toBe(beforeReturn);
  expect(errors).toEqual([]);
});

test('explores the saved period, preserves group totals in Excel and audits a confirmed actual discharge', async ({
  page,
}) => {
  test.setTimeout(90000);
  const { requests, errors } = await open(page);
  const clinicalWrites = () =>
    requests.filter(r => r.endpoint === 'archiveCudyrHistory' && r.kind !== 'save-read-view');
  await expect(page.getByRole('region', { name: 'Totales de la vista filtrada' })).toContainText(
    'Elegibles conocidos2'
  );
  await expect(page.getByRole('region', { name: 'Totales de la vista filtrada' })).toContainText(
    'No elegibles2'
  );
  await screenshot(page, 'cudyr-explorador-escritorio');
  await page
    .getByRole('combobox', { name: 'Grupo de camas', exact: true })
    .selectOption('intermedia');
  await expect(page.getByText('PACIENTE SINTÉTICO NEO1', { exact: true })).toHaveCount(0);
  await expect(page.getByText('PACIENTE SINTÉTICO R1', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Limpiar filtros' }).click();
  const downloadEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Excel para Estadística' }).click();
  const download = await downloadEvent;
  const file = await download.path();
  const workbook = new Workbook();
  await workbook.xlsx.readFile(file!);
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
  expect(workbook.getWorksheet('20-02-2026')!.getCell('B11').value).toBe(1);
  expect(workbook.getWorksheet('20-02-2026')!.getCell('C15').value).toBe(0);
  expect(clinicalWrites()).toHaveLength(0);
  await page
    .getByRole('button', { name: 'Ver detalle de PACIENTE SINTÉTICO R1 del ' + DATE })
    .click();
  await expect(page.getByRole('dialog')).toContainText('AUTORA SINTÉTICA');
  await screenshot(page, 'cudyr-detalle-escritorio');
  await page.getByRole('button', { name: 'Verificar o corregir alta real' }).click();
  await page.getByLabel('Fecha real de alta').fill('2026-02-19');
  await page.getByLabel('Hora, si está confirmada').fill('12:00');
  await page
    .getByLabel('Motivo y respaldo de la corrección')
    .fill('Salida física comprobada en prueba sintética.');
  await expect(page.getByRole('button', { name: 'Guardar alta real' })).toBeDisabled();
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Guardar alta real' }).click();
  await expect(page.getByRole('region', { name: 'Totales de la vista filtrada' })).toContainText(
    'No elegibles3',
    { timeout: 30000 }
  );
  expect(clinicalWrites()).toEqual([
    { endpoint: 'archiveCudyrHistory', kind: 'correct-discharge' },
  ]);
  expect((await db.collection(hospital + '/cudyrDischargeAudit').get()).size).toBe(1);
  expect((await db.doc(hospital + '/dailyRecords/' + DATE).get()).data()?.discharges).toEqual([]);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Volver al registro CUDYR' }).click();
  await expect(page.getByRole('heading', { name: 'CUDYR · control diario' })).toBeVisible();
  await page.getByRole('combobox').selectOption('no_elegible');
  await expect(page.getByText('PACIENTE SINTÉTICO R1', { exact: true })).toBeVisible();
  const updatedDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Excel mensual', exact: true }).click();
  const updated = new Workbook();
  await updated.xlsx.readFile((await (await updatedDownload).path())!);
  expect(updated.getWorksheet('20-02-2026')!.getCell('B19').value).toBe(1);
  expect(errors).toEqual([]);
});

test('retains the verified copy and blocks exports on a failed refresh, then recovers', async ({
  page,
}) => {
  test.setTimeout(90000);
  const { errors } = await open(page);
  const statistics = page.getByRole('button', { name: 'Excel para Estadística' });
  const audit = page.getByRole('button', { name: 'Excel de auditoría' });
  await expect(statistics).toBeEnabled();
  const totals = await page
    .getByRole('region', { name: 'Totales de la vista filtrada' })
    .textContent();
  const fail = async (route: import('@playwright/test').Route) => {
    await route.fulfill({
      status: 503,
      headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' },
      json: { error: { status: 'UNAVAILABLE', message: 'Fallo sintético de lectura' } },
    });
  };
  await page.route('**/readCudyrHistory', fail);
  await page.getByRole('button', { name: 'Consultar período' }).click();
  await expect(statistics).toBeDisabled();
  await expect(audit).toBeDisabled();
  await expect(page.getByText(/Lectura incompleta de Firebase/)).toBeVisible();
  await expect(page.getByText('PACIENTE SINTÉTICO R1', { exact: true })).toBeVisible();
  expect(
    await page.getByRole('region', { name: 'Totales de la vista filtrada' }).textContent()
  ).toBe(totals);
  await page.unroute('**/readCudyrHistory', fail);
  await page.getByRole('button', { name: 'Consultar período' }).click();
  await expect(statistics).toBeEnabled();
  await expect(audit).toBeEnabled();
  await expect(page.getByText(/Lectura incompleta de Firebase/)).toHaveCount(0);
  expect(errors).toEqual([]);
});
