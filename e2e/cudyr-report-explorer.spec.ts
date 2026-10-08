import { utils, write } from 'xlsx';
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import type { App } from 'firebase-admin/app';
import type { Firestore } from 'firebase-admin/firestore';
import ExcelJS from 'exceljs';
import {
  bootstrapSeededRecord,
  buildCanonicalE2ERecord,
  ensureAuthenticated,
} from './fixtures/auth';

const require = createRequire(import.meta.url);
// Use the same Admin SDK instance as the callable implementation after separate npm installs.
const requireFunctions = createRequire(new URL('../functions/package.json', import.meta.url));
const { initializeApp, deleteApp } = requireFunctions(
  'firebase-admin/app'
) as typeof import('firebase-admin/app');
const { getFirestore } = requireFunctions(
  'firebase-admin/firestore'
) as typeof import('firebase-admin/firestore');
const { Workbook } = ExcelJS;
const { createCudyrHistoryFunctions } = require('../functions/lib/cudyrHistoryFunctions.js');
const DATE = '2026-02-20';
const hospital = 'hospitals/hanga_roa';
const episode = 'synthetic-cudyr-report';
let app: App;
let db: Firestore;
let rules: RulesTestEnvironment;
const patient = (bedId: string, id = episode, bedMode = 'Cama') => ({
  bedId,
  bedMode,
  clinicalEpisodeId: id,
  patientName: 'PACIENTE SINTÉTICO ' + bedId,
  firstName: 'PACIENTE',
  lastName: 'SINTÉTICO',
  secondLastName: bedId,
  rut: bedId === 'R1' ? '11111111-1' : 'synthetic-' + bedId,
  documentType: 'RUT',
  pathology: 'Diagnóstico sintético para reporte',
  specialty: 'Medicina',
  admissionDate: '2026-02-18',
  admissionTime: '09:00',
  isBlocked: false,
  hasCompanionCrib: false,
  cudyr: {
    changeClothes: 0,
    mobilization: 0,
    feeding: 0,
    elimination: 0,
    psychosocial: 3,
    surveillance: 3,
    vitalSigns: 2,
    fluidBalance: 0,
    oxygenTherapy: 0,
    airway: 0,
    proInterventions: 0,
    skinCare: 0,
    pharmacology: 0,
    invasiveElements: 0,
  },
});
const record = () =>
  buildCanonicalE2ERecord(DATE, {
    beds: {
      R1: patient('R1'),
      NEO1: patient('NEO1', 'synthetic-media'),
      H1C1: patient('H1C1', 'synthetic-crib', 'Cuna'),
      CMA1: { ...patient('CMA1', 'synthetic-cma'), location: 'CMA recuperación' },
    },
    discharges: [],
    transfers: [],
    cma: [],
  });
const context = {
  auth: {
    uid: 'synthetic-cudyr-editor',
    token: { email: 'report@example.com', name: 'Editor Sintético' },
  },
};
const cors = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': '*',
  'access-control-allow-methods': 'POST,OPTIONS',
};
test.beforeAll(async () => {
  const host = process.env.FIRESTORE_EMULATOR_HOST || '';
  if (!/^(127\.0\.0\.1|localhost):\d+$/.test(host))
    throw new Error('CUDYR browser proof requires a local Firestore emulator.');
  const [hostname, port] = host.split(':');
  // Isolated synthetic demo project only. Browser auth is the repository fixture; callable guards
  // are exercised independently below and in cudyr-discharge.emulator.test.ts.
  rules = await initializeTestEnvironment({
    projectId: 'demo-hhr-e2e',
    firestore: {
      host: hostname,
      port: Number(port),
      rules:
        'rules_version = "2"; service cloud.firestore { match /databases/{database}/documents { match /hospitals/hanga_roa/dailyRecords/{day} { allow read: if true; } } }',
    },
  });
  app = initializeApp({ projectId: 'demo-hhr-e2e' }, 'cudyr-report-e2e');
  db = getFirestore(app);
});
test.afterAll(async () => {
  if (db) await db.terminate();
  if (app) await deleteApp(app);
  if (rules) await rules.cleanup();
});

const open = async (page: Page, role: 'admin' | 'viewer' = 'admin') => {
  for (const collection of [
    'cudyrMonthlyReviews',
    'cudyrMonthlySupplements',
    'cudyrSupplementFiles',
    'cudyrSupplementImports',
  ])
    await db.recursiveDelete(db.collection(hospital + '/' + collection));
  await db.recursiveDelete(db.collection(hospital + '/cudyrDischargeCorrections'));
  await db.recursiveDelete(db.collection(hospital + '/cudyrDischargeAudit'));
  await db.doc(hospital + '/dailyRecords/' + DATE).set(record());
  await db.doc(hospital + '/cudyrHistory/synthetic-observation').set({
    schemaVersion: 1,
    id: 'synthetic-observation',
    eventKey: 'synthetic-event',
    censusDate: DATE,
    attributionRule: 'hhr-night-v1',
    captureCensusDate: DATE,
    captureContexts: [{ ...patient('R1'), section: 'census' }],
    evaluation: {
      clinicalEpisodeId: episode,
      sourceEvaluationId: 'synthetic-event',
      category: 'C2',
      source: 'gestion_camas',
      recordedAt: '2026-02-20T20:00:00-05:00',
      author: 'AUTORA SINTÉTICA',
      authorId: 'author',
      authorRole: 'Enfermera',
      dependencyScore: 9,
      riskScore: 8,
    },
    firstCapturedAt: '2026-02-21T06:00:00Z',
    lastVerifiedAt: '2026-02-21T06:00:00Z',
    firstCapturedBy: 'sync@example.com',
    firstCaptureRunId: 'run',
    lastVerifiedRunId: 'run',
  });
  const fns = createCudyrHistoryFunctions({
    firestore: db,
    resolveRoleForEmail: async () => (role === 'admin' ? 'admin' : 'doctor_urgency'),
    hasCallableClinicalAccess: async () => true,
  });
  const calls: string[] = [];
  for (const endpoint of ['readCudyrHistory', 'archiveCudyrHistory'])
    await page.route('**/' + endpoint, async route => {
      if (route.request().method() === 'OPTIONS') {
        await route.fulfill({ status: 204, headers: cors });
        return;
      }
      calls.push(endpoint);
      const result = await fns[endpoint].run(route.request().postDataJSON().data, context);
      await route.fulfill({ status: 200, headers: cors, json: { result } });
    });
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const runtimeConfig = {
    apiKey: 'placeholder',
    authDomain: 'demo-hhr.firebaseapp.com',
    projectId: 'demo-hhr-e2e',
    storageBucket: 'demo-hhr-e2e.firebasestorage.app',
    messagingSenderId: '1234567890',
    appId: '1:1234567890:web:abcdef123456',
  };
  await page.route('**/.netlify/functions/firebase-config**', route =>
    route.fulfill({ json: runtimeConfig })
  );
  await page.addInitScript(
    config => localStorage.setItem('hhr_firebase_config', JSON.stringify(config)),
    runtimeConfig
  );
  await bootstrapSeededRecord(page, {
    role,
    date: DATE,
    record: record(),
    useRuntimeOverride: true,
  });
  await page.goto('/cudyr?date=' + DATE);
  await ensureAuthenticated(page);
  await page.getByRole('button', { name: 'Explorar reporte estadístico' }).click();
  await expect(page.getByRole('heading', { name: 'Explorador CUDYR' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Consultar período' })).toBeEnabled({
    timeout: 30000,
  });
  await page.getByLabel('Desde', { exact: true }).fill(DATE);
  await page.getByLabel('Hasta', { exact: true }).fill(DATE);
  await page.getByRole('button', { name: 'Consultar período' }).click();
  await expect(page.getByText('PACIENTE SINTÉTICO R1', { exact: true })).toBeVisible({
    timeout: 30000,
  });
  return { calls, errors };
};
const screenshot = async (page: Page, name: string) => {
  if (!process.env.CUDYR_QA_OUTPUT) return;
  await mkdir(process.env.CUDYR_QA_OUTPUT, { recursive: true });
  await page.screenshot({
    path: path.join(process.env.CUDYR_QA_OUTPUT, name + '.png'),
    fullPage: !name.includes('movil'),
    animations: 'disabled',
  });
};
test('explores the saved period, preserves group totals in Excel and audits a confirmed actual discharge', async ({
  page,
}) => {
  test.setTimeout(90000);
  const { calls, errors } = await open(page);
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
  expect(workbook.getWorksheet('20-02-2026')!.getCell('C15').value).toBe(1);
  expect(calls.filter(call => call === 'archiveCudyrHistory')).toHaveLength(0);
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
  expect(calls.filter(call => call === 'archiveCudyrHistory')).toHaveLength(1);
  expect((await db.collection(hospital + '/cudyrDischargeAudit').get()).size).toBe(1);
  expect((await db.doc(hospital + '/dailyRecords/' + DATE).get()).data()?.discharges).toEqual([]);
  expect(errors).toEqual([]);
});
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
