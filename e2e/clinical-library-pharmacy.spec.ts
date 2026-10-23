import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFRawStream, decodePDFRawStream } from 'pdf-lib';
import { buildCanonicalE2ERecord, MOCK_USERS } from './fixtures/auth';
import { installPreviewFirebaseRuntime } from './fixtures/previewFirebase';

const PREVIEW_DATE = process.env.E2E_FIXED_DATE ?? '2026-10-22';
const ACT_DATE = '2026-10-22';
const ACETYLSALICYLIC = 'ACETILSALICÍLICO, ÁCIDO 100 MG COMPRIMIDO';
const ACETIC = 'ACÉTICO, ÁCIDO 3% 500 ML - 100 ML';
const PARACETAMOL = 'PARACETAMOL COMPRIMIDO 500 MG';
const AMOXICILLIN = 'AMOXICILINA + ACIDO CLAVULANICO SUSPENSION ORAL 400 MG + 57 MG 70 ML';
const PAPER_DIMENSIONS = {
  a4: { width: 595.28, height: 841.89 },
  letter: { width: 612, height: 792 },
};

const artifactPath = (name: string): string => {
  const directory = process.env.PHARMACY_SHOTS_DIR || 'reports/e2e/pharmacy';
  fs.mkdirSync(directory, { recursive: true });
  return path.resolve(directory, name);
};

const capture = async (page: Page, name: string): Promise<void> => {
  await page.screenshot({ path: artifactPath(name), fullPage: false });
};

const seedPersistedSession = async (
  page: Page,
  role: keyof typeof MOCK_USERS = 'admin'
): Promise<void> => {
  const firebaseConfig = await installPreviewFirebaseRuntime(page);
  await page.addInitScript(
    ({ bootstrapUser, date, seededRecord, runtimeConfig }) => {
      if (window !== window.top || !/^https?:$/.test(location.protocol)) return;
      Object.assign(window, { __HHR_E2E_OVERRIDE__: { [date]: seededRecord } });
      localStorage.setItem('hhr_e2e_bootstrap_user', JSON.stringify(bootstrapUser));
      localStorage.setItem('firebase:authUser:test:[DEFAULT]', JSON.stringify({ uid: 'preview' }));
      localStorage.setItem('hhr_firebase_config', JSON.stringify(runtimeConfig));
      localStorage.setItem('hanga_roa_hospital_data', JSON.stringify({ [date]: seededRecord }));
    },
    {
      bootstrapUser: MOCK_USERS[role],
      date: PREVIEW_DATE,
      seededRecord: buildCanonicalE2ERecord(PREVIEW_DATE),
      runtimeConfig: firebaseConfig,
    }
  );
};

const openAct = async (page: Page, kind: 'return' | 'disposal'): Promise<Locator> => {
  await page.goto(`/?date=${PREVIEW_DATE}`);
  await page.getByTestId('clinical-library-quick-action').click({ timeout: 20_000 });
  const drawer = page.getByTestId('clinical-library-drawer');
  await drawer.getByRole('button', { name: 'Formularios', exact: true }).click();
  await drawer
    .getByRole('button', {
      name:
        kind === 'return'
          ? 'Completar Acta de devolución de fármacos'
          : 'Completar Acta de entrega de fármacos eliminados',
      exact: true,
    })
    .click();
  const editor = drawer.getByTestId(`library-tool-pharmacy-${kind}`);
  await expect(editor.getByLabel('Nombre del responsable', { exact: true })).toBeVisible();
  return editor;
};

const fillProfessional = async (
  editor: Locator,
  displayName: string,
  suggestedRole = ''
): Promise<void> => {
  await expect(editor.getByLabel('Nombre del responsable', { exact: true })).toHaveValue(
    displayName
  );
  // Session roles can suggest a title; a display name does not establish a RUT.
  await expect(editor.getByLabel('RUT del responsable', { exact: true })).toHaveValue('');
  await expect(editor.getByLabel('Cargo', { exact: true })).toHaveValue(suggestedRole);
  await expect(editor.getByLabel('Unidad o servicio', { exact: true })).toHaveValue(
    'Hospitalizados'
  );
  await editor.getByLabel('RUT del responsable', { exact: true }).fill('12345678-5');
  await editor.getByLabel('Cargo', { exact: true }).fill('Enfermería de validación');
  await editor.getByLabel('Fecha del acta', { exact: true }).fill(ACT_DATE);
};

const selectArsenalItem = async (
  editor: Locator,
  row: number,
  query: string,
  name: string
): Promise<Locator> => {
  const line = editor.getByRole('group', { name: `Registro ${row}`, exact: true });
  await line.getByRole('searchbox', { name: 'Buscar fármaco o insumo' }).fill(query);
  const results = line.getByRole('list', { name: `Resultados del arsenal, registro ${row}` });
  await results.getByRole('button').filter({ hasText: name }).click();
  await expect(line.getByText(name, { exact: true })).toBeVisible();
  await expect(line.getByRole('searchbox')).toHaveCount(0);
  return line;
};

const prepareAndDownload = async (
  page: Page,
  editor: Locator,
  filename: string
): Promise<PDFDocument> => {
  await editor.getByRole('button', { name: 'Preparar vista previa', exact: true }).click();
  await expect(editor.locator('iframe[title^="Vista previa ·"]')).toBeVisible({ timeout: 15_000 });
  const downloadEvent = page.waitForEvent('download');
  await editor.getByRole('button', { name: 'Descargar', exact: true }).click();
  const download = await downloadEvent;
  expect(download.suggestedFilename()).toMatch(/^acta-.*-2026-10-22\.pdf$/);
  const destination = artifactPath(filename);
  await download.saveAs(destination);
  expect(await download.failure()).toBeNull();
  return PDFDocument.load(new Uint8Array(fs.readFileSync(destination)));
};

const expectPreviewInvalidated = async (editor: Locator): Promise<void> => {
  await expect(editor.locator('iframe')).toHaveCount(0);
  await expect(editor.getByRole('button', { name: 'Descargar', exact: true })).toHaveCount(0);
  await expect(editor.getByRole('button', { name: 'Imprimir', exact: true })).toHaveCount(0);
};

const pageOperators = (pdf: PDFDocument, index: number): string => {
  const contents = pdf.getPage(index).node.Contents();
  const streams =
    contents instanceof PDFArray
      ? contents.asArray().map(reference => pdf.context.lookup(reference))
      : [contents];
  return streams
    .filter((value): value is PDFRawStream => value instanceof PDFRawStream)
    .map(stream => Buffer.from(decodePDFRawStream(stream).decode()).toString('latin1'))
    .join('\n');
};

const expectPdfText = (pdf: PDFDocument, values: readonly string[]): void => {
  const text = pdf
    .getPages()
    .map((_, index) => pageOperators(pdf, index))
    .flatMap(operators =>
      [...operators.matchAll(/<([\da-f]+)>\s*Tj/gi)].map(match =>
        Buffer.from(match[1], 'hex').toString('latin1')
      )
    )
    .join(' ')
    .replace(/\s+/g, ' ');
  for (const value of values) {
    expect(text, `PDF contains ${value}`).toContain(value.replace(/\s+/g, ' '));
  }
};

const expectInstitutionalPages = (
  pdf: PDFDocument,
  paperSize: keyof typeof PAPER_DIMENSIONS = 'a4'
): void => {
  const dimensions = PAPER_DIMENSIONS[paperSize];
  pdf.getPages().forEach((page, index) => {
    expect(page.getWidth()).toBeCloseTo(dimensions.width);
    expect(page.getHeight()).toBeCloseTo(dimensions.height);
    expect(page.getHeight()).toBeGreaterThan(page.getWidth());
    const operators = pageOperators(pdf, index);
    expect(operators).toContain(Buffer.from('HOSPITAL HANGA ROA').toString('hex').toUpperCase());
    expect(operators).toContain(' Do');
    const resources = page.node.Resources()?.lookup(PDFName.of('XObject'));
    expect(resources).toBeInstanceOf(PDFDict);
    if (!(resources instanceof PDFDict)) throw new Error('PDF page has no image resources.');
    const images = resources
      .values()
      .map(reference => pdf.context.lookup(reference))
      .filter(
        value =>
          value instanceof PDFRawStream &&
          value.dict.get(PDFName.of('Subtype')) === PDFName.of('Image')
      );
    expect(images.length, `Institutional logo on page ${index + 1}`).toBeGreaterThan(0);
  });
  expect(pdf.getForm().getFields()).toHaveLength(0);
};

test.describe('Pharmacy acts in Documentos (synthetic preview session)', () => {
  test.describe.configure({ timeout: 120_000 });
  test.use({ viewport: { width: 1440, height: 1000 } });

  test('prepares a return with the signed-in admin, preserves edits and invalidates stale PDFs', async ({
    page,
  }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    await seedPersistedSession(page);
    const editor = await openAct(page, 'return');
    const paperSize = editor.getByRole('combobox', { name: 'Tamaño de papel', exact: true });
    await expect(paperSize).toHaveValue('a4');
    await expect(paperSize.getByRole('option')).toHaveText(['A4', 'Carta']);
    await expect(editor.getByText('Arsenal HHR 2025', { exact: false })).toBeVisible();
    await editor.getByRole('button', { name: 'Preparar vista previa', exact: true }).click();
    await expect(editor.getByRole('alert')).toContainText('Completa el cargo del profesional.');
    await expect(editor.locator('iframe')).toHaveCount(0);
    await fillProfessional(editor, MOCK_USERS.admin.displayName);
    await editor.getByLabel('N.° / año (opcional)', { exact: true }).fill('12/2026');
    await editor.getByRole('button', { name: 'Guardar mis datos en este equipo' }).click();
    await expect(editor.getByRole('status')).toContainText('Tus datos se guardaron');

    // Both words omit the accents carried by the catalogue's official name.
    const first = await selectArsenalItem(editor, 1, 'acetilsalicilico acido 100', ACETYLSALICYLIC);
    await first.getByLabel('Cantidad (comprimido)', { exact: true }).fill('2,5');
    await first.getByLabel('Vencimiento (si corresponde)', { exact: true }).fill('2027-03-31');
    await first.getByLabel('Paciente (opcional)', { exact: true }).fill('PACIENTE SINTÉTICO');
    await first
      .getByRole('textbox', { name: 'Fundamento de la devolución', exact: true })
      .fill('Sobre stock de validación');
    await editor.getByRole('button', { name: 'Agregar fármaco o insumo' }).click();
    const second = await selectArsenalItem(editor, 2, 'paracetamol 500', PARACETAMOL);
    await second.getByLabel('Cantidad (comprimido)', { exact: true }).fill('12');
    await second
      .getByRole('textbox', { name: 'Fundamento de la devolución', exact: true })
      .fill('Ajuste de stock de validación');
    const original = await prepareAndDownload(page, editor, 'return-original.pdf');
    expect(original.getPageCount()).toBe(1);
    expectInstitutionalPages(original);
    const returnValues = [
      MOCK_USERS.admin.displayName,
      '12.345.678-5',
      'Enfermería de validación',
      'Hospitalizados',
      'Bodega de Fármacos HHR',
      '12/2026',
      '22/10/2026',
      ACETYLSALICYLIC,
      '2,5',
      '31/03/2027',
      'PACIENTE SINTÉTICO',
      'Sobre stock de validación',
      PARACETAMOL,
      'Ajuste de stock de validación',
      'Firma de quien entrega',
      'Recibe conforme',
    ];
    expectPdfText(original, returnValues);
    await capture(page, 'desktop-return-preview.png');

    await paperSize.selectOption('letter');
    await expectPreviewInvalidated(editor);
    await expect(first.getByLabel('Cantidad (comprimido)', { exact: true })).toHaveValue('2,5');
    await expect(first.getByLabel('Paciente (opcional)', { exact: true })).toHaveValue(
      'PACIENTE SINTÉTICO'
    );
    await expect(
      first.getByRole('textbox', { name: 'Fundamento de la devolución', exact: true })
    ).toHaveValue('Sobre stock de validación');
    await expect(second.getByLabel('Cantidad (comprimido)', { exact: true })).toHaveValue('12');
    const letter = await prepareAndDownload(page, editor, 'return-letter.pdf');
    expect(letter.getPageCount()).toBe(1);
    expectInstitutionalPages(letter, 'letter');
    expectPdfText(letter, returnValues);
    await capture(page, 'desktop-return-letter-preview.png');

    await paperSize.selectOption('a4');
    await expectPreviewInvalidated(editor);
    await expect(first.getByLabel('Cantidad (comprimido)', { exact: true })).toHaveValue('2,5');
    await editor.getByRole('button', { name: 'Preparar vista previa', exact: true }).click();
    await expect(editor.locator('iframe[title^="Vista previa ·"]')).toBeVisible();
    await first.getByLabel('Cantidad (comprimido)', { exact: true }).fill('7');
    await expectPreviewInvalidated(editor);
    const revised = await prepareAndDownload(page, editor, 'return-revised.pdf');
    expectInstitutionalPages(revised, 'a4');
    expectPdfText(revised, ['7']);
    expect(pageOperators(revised, 0)).not.toContain(
      Buffer.from('2,5').toString('hex').toUpperCase()
    );

    await page.keyboard.press('Escape');
    const exit = page.getByRole('alertdialog', { name: '¿Salir del acta de farmacia?' });
    await expect(exit).toBeVisible();
    await capture(page, 'desktop-unsaved-exit-confirmation.png');
    await page.keyboard.press('Escape');
    await expect(exit).toHaveCount(0);
    await expect(first.getByLabel('Cantidad (comprimido)', { exact: true })).toHaveValue('7');
    await editor.getByRole('button', { name: 'Volver a la biblioteca', exact: true }).click();
    await expect(exit).toBeVisible();
    await exit.getByRole('button', { name: 'Seguir editando', exact: true }).click();
    await expect(editor.locator('iframe')).toBeVisible();
    await editor.getByRole('button', { name: 'Volver a la biblioteca', exact: true }).click();
    await exit.getByRole('button', { name: 'Salir y descartar', exact: true }).click();
    await expect(editor).toHaveCount(0);
    const drawer = page.getByTestId('clinical-library-drawer');
    await drawer
      .getByRole('button', { name: 'Completar Acta de devolución de fármacos', exact: true })
      .click();
    const reopened = drawer.getByTestId('library-tool-pharmacy-return');
    await expect(reopened.getByLabel('Nombre del responsable', { exact: true })).toHaveValue(
      MOCK_USERS.admin.displayName
    );
    await expect(reopened.getByLabel('RUT del responsable', { exact: true })).toHaveValue(
      '12.345.678-5'
    );
    await expect(reopened.getByLabel('Cargo', { exact: true })).toHaveValue(
      'Enfermería de validación'
    );
    await expect(reopened.getByRole('group', { name: /^Registro/ })).toHaveCount(1);
    await expect(reopened.getByLabel('Paciente (opcional)', { exact: true })).toHaveValue('');
    await expect(reopened.getByLabel('Cantidad', { exact: true })).toHaveValue('');
    const savedProfile = await page.evaluate(
      uid => localStorage.getItem(`hhr_pharmacy_professional_v1_${encodeURIComponent(uid)}`),
      MOCK_USERS.admin.uid
    );
    expect(savedProfile).toContain('Enfermería de validación');
    expect(savedProfile).not.toContain('PACIENTE');
    expect(savedProfile).not.toContain('ACETILSALIC');
    expect(pageErrors).toEqual([]);
  });

  test('requires the disposal cause and expiry, and prints every row with a logo on each page', async ({
    page,
  }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    await seedPersistedSession(page);
    const editor = await openAct(page, 'disposal');
    const paperSize = editor.getByRole('combobox', { name: 'Tamaño de papel', exact: true });
    await expect(paperSize).toHaveValue('a4');
    await fillProfessional(editor, MOCK_USERS.admin.displayName);
    const first = await selectArsenalItem(editor, 1, 'acetico acido', ACETIC);
    await first.getByLabel('Cantidad (frasco)', { exact: true }).fill('3');
    await editor.getByRole('button', { name: 'Preparar vista previa', exact: true }).click();
    await expect(editor.getByRole('alert')).toContainText(
      'Indica el número y año del acta de entrega.'
    );
    await expect(editor.getByRole('alert')).toContainText('selecciona la causa de eliminación.');
    await editor.getByLabel('N.° / año (obligatorio)', { exact: true }).fill('13/2026');
    await first
      .getByRole('combobox', { name: 'Causa de eliminación', exact: true })
      .selectOption('expired');
    await editor.getByRole('button', { name: 'Preparar vista previa', exact: true }).click();
    await expect(editor.getByRole('alert')).toContainText(
      'indica la fecha de vencimiento del producto expirado.'
    );
    await expect(editor.locator('iframe')).toHaveCount(0);
    await first.getByLabel('Vencimiento (obligatorio)', { exact: true }).fill('2026-09-30');
    for (let index = 2; index <= 13; index += 1) {
      await editor.getByRole('button', { name: 'Agregar fármaco o insumo' }).click();
      const line = await selectArsenalItem(editor, index, 'paracetamol 500', PARACETAMOL);
      await line.getByLabel('Cantidad (comprimido)', { exact: true }).fill(String(index));
      await line
        .getByRole('combobox', { name: 'Causa de eliminación', exact: true })
        .selectOption(index % 2 ? 'damaged' : 'unlabelled');
    }
    await editor.getByRole('button', { name: 'Agregar fármaco o insumo' }).click();
    const last = editor.getByRole('group', { name: 'Registro 14', exact: true });
    await last.getByRole('button', { name: 'Ingresar fuera del arsenal', exact: true }).click();
    await last
      .getByLabel('Nombre del fármaco o insumo', { exact: true })
      .fill('INSUMO SINTÉTICO ÚLTIMO REGISTRO');
    await last.getByLabel('Presentación / unidad de cantidad', { exact: true }).fill('Unidad');
    await last.getByLabel('Cantidad (unidad)', { exact: true }).fill('14');
    await last
      .getByRole('combobox', { name: 'Causa de eliminación', exact: true })
      .selectOption('unlabelled');
    // Removing an extra blank row must preserve the populated final record.
    await editor.getByRole('button', { name: 'Agregar fármaco o insumo' }).click();
    await editor.getByRole('button', { name: 'Eliminar registro 15', exact: true }).click();
    await expect(editor.getByRole('group', { name: /^Registro/ })).toHaveCount(14);
    await paperSize.selectOption('letter');
    const pdf = await prepareAndDownload(page, editor, 'disposal-multiple-pages.pdf');
    expect(pdf.getPageCount()).toBeGreaterThan(1);
    expectInstitutionalPages(pdf, 'letter');
    const disposalValues = [
      '13/2026',
      '22/10/2026',
      MOCK_USERS.admin.displayName,
      '12.345.678-5',
      'Enfermería de validación',
      'ACÉTICO, ÁCIDO 3%',
      '30/09/2026',
      'CAUSA DE ELIMINACIÓN',
      'INSUMO SINTÉTICO',
      'ÚLTIMO REGISTRO',
      'Unidad',
      'Firma de quien entrega',
      'Recibe conforme',
    ];
    expectPdfText(pdf, disposalValues);
    await capture(page, 'desktop-disposal-preview.png');
    await paperSize.selectOption('a4');
    await expectPreviewInvalidated(editor);
    await expect(editor.getByRole('group', { name: /^Registro/ })).toHaveCount(14);
    await expect(first.getByLabel('Cantidad (frasco)', { exact: true })).toHaveValue('3');
    await expect(
      first.getByRole('combobox', { name: 'Causa de eliminación', exact: true })
    ).toHaveValue('expired');
    await expect(first.getByLabel('Vencimiento (obligatorio)', { exact: true })).toHaveValue(
      '2026-09-30'
    );
    await expect(last.getByLabel('Nombre del fármaco o insumo', { exact: true })).toHaveValue(
      'INSUMO SINTÉTICO ÚLTIMO REGISTRO'
    );
    const a4 = await prepareAndDownload(page, editor, 'disposal-multiple-pages-a4.pdf');
    expect(a4.getPageCount()).toBeGreaterThan(1);
    expectInstitutionalPages(a4, 'a4');
    expectPdfText(a4, disposalValues);
    await capture(page, 'desktop-disposal-a4-preview.png');
    expect(pageErrors).toEqual([]);
  });

  test('prefills the nurse session and keeps the pharmacy form inside a 375 px screen', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    const pageErrors: string[] = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    await seedPersistedSession(page, 'editor');
    const editor = await openAct(page, 'return');
    await expect(
      editor.getByRole('combobox', { name: 'Tamaño de papel', exact: true })
    ).toHaveValue('a4');
    await fillProfessional(editor, MOCK_USERS.editor.displayName, 'Enfermero/a');
    await capture(page, 'mobile-nurse-prefill.png');
    const line = await selectArsenalItem(editor, 1, 'amoxicilina clavulanico 400', AMOXICILLIN);
    await line.getByLabel('Cantidad (mililitros)', { exact: true }).fill('10,5');
    await line
      .getByRole('textbox', { name: 'Fundamento de la devolución', exact: true })
      .fill('Sobre stock de validación móvil');
    await capture(page, 'mobile-arsenal-selection.png');
    const pdf = await prepareAndDownload(page, editor, 'mobile-nurse-return.pdf');
    expectInstitutionalPages(pdf, 'a4');
    expectPdfText(pdf, [MOCK_USERS.editor.displayName, '10,5']);
    const drawer = page.getByTestId('clinical-library-drawer');
    const dimensions = await drawer.evaluate(element => ({
      viewport: window.innerWidth,
      left: element.getBoundingClientRect().left,
      right: element.getBoundingClientRect().right,
      width: element.clientWidth,
      contentWidth: element.scrollWidth,
    }));
    expect(dimensions.left).toBeGreaterThanOrEqual(0);
    expect(dimensions.right).toBeLessThanOrEqual(dimensions.viewport);
    expect(dimensions.contentWidth).toBeLessThanOrEqual(dimensions.width + 1);
    const formDimensions = await editor.evaluate(element => ({
      width: element.clientWidth,
      contentWidth: element.scrollWidth,
    }));
    expect(formDimensions.contentWidth).toBeLessThanOrEqual(formDimensions.width + 1);
    await capture(page, 'mobile-pdf-preview.png');
    expect(pageErrors).toEqual([]);
  });
});
