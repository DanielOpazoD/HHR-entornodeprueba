import { expect, test, type Page } from '@playwright/test';
import PizZip from 'pizzip';

import {
  bootstrapSeededRecord,
  buildCanonicalE2ERecord,
  ensureAuthenticated,
} from './fixtures/auth';
import { openPatientClinicalTopic } from './fixtures/patientClinicalTopics';

const E2E_DATE = process.env.E2E_FIXED_DATE ?? '2026-02-20';

type ClinicalDocumentPrintWindow = Window & {
  __clinicalDocumentPrintCalled?: boolean;
};

const buildAiImportRecord = (date: string) => {
  const canonical = buildCanonicalE2ERecord(date);
  const beds = canonical.beds as Record<string, Record<string, unknown>>;

  return buildCanonicalE2ERecord(date, {
    beds: {
      ...beds,
      R1: {
        ...beds.R1,
        patientName: 'PACIENTE IMPORT IA',
        rut: '12.345.678-5',
        pathology: 'Neumonia adquirida en la comunidad',
        specialty: 'Medicina',
        status: 'Estable',
        age: '45',
        admissionDate: date,
      },
    },
  });
};

const buildMinimalDocx = (paragraphs: string[]): Buffer => {
  const zip = new PizZip();
  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
    <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
      <w:body>
        ${paragraphs
          .map(paragraph => `<w:p><w:r><w:t xml:space="preserve">${paragraph}</w:t></w:r></w:p>`)
          .join('')}
      </w:body>
    </w:document>`;

  zip.file(
    '[Content_Types].xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
      <Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
        <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
        <Default Extension="xml" ContentType="application/xml"/>
        <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
      </Types>`
  );
  zip.folder('_rels')?.file(
    '.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
      <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
        <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
      </Relationships>`
  );
  zip.folder('word')?.file('document.xml', documentXml);

  return zip.generate({ type: 'nodebuffer' });
};

const openClinicalDocumentsFromR1 = async (page: Page) => {
  const patientRow = page.locator('[data-testid="patient-row"][data-bed-id="R1"]').first();
  await expect(patientRow).toBeVisible({ timeout: 10_000 });

  await openPatientClinicalTopic(page, 'R1', 'Documentos');
  await expect(page.getByTestId('clinical-documents-workspace')).toBeVisible({ timeout: 15_000 });
};

const openSeededAiImportCensus = async (page: Page) => {
  await bootstrapSeededRecord(page, {
    role: 'admin',
    date: E2E_DATE,
    record: buildAiImportRecord(E2E_DATE),
    useRuntimeOverride: true,
    forceEditableRecord: true,
  });
  await page.goto(`/censo?date=${E2E_DATE}`);
  await ensureAuthenticated(page);
  await expect(page.getByTestId('census-table')).toBeVisible({ timeout: 20_000 });
};

const uploadAiImportDocx = async (page: Page, fileName = 'traslado-ia.docx') => {
  await page.getByRole('button', { name: /herramientas avanzadas/i }).click();

  const fileInput = page.getByLabel(/archivo pdf o docx para importar con ia/i);
  await fileInput.setInputFiles({
    name: fileName,
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    buffer: buildMinimalDocx([
      'Informe de traslado por neumonia con requerimiento de oxigeno.',
      'Paciente evoluciona estable y requiere continuidad de manejo.',
      'Plan: continuar antibiotico y control clinico en centro receptor.',
    ]),
  });
};

const expectImportedAiDocumentContent = async (page: Page) => {
  await expect(page.getByText('Epicrisis traslado').first()).toBeVisible();
  await expect(page.getByText('Traslado por neumonia con oxigenoterapia.')).toBeVisible();
  await expect(page.getByText('Continuar ceftriaxona y control de saturacion.')).toBeVisible();
};

const routeSuccessfulAiImport = async (
  page: Page,
  options: { assertSourceText?: boolean } = {}
) => {
  await page.route('**/.netlify/functions/clinical-document-ai-import', async route => {
    if (options.assertSourceText) {
      const payload = route.request().postDataJSON() as { sourceText?: string };
      expect(payload.sourceText?.toLowerCase()).toContain('traslado por neumonia');
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        available: true,
        provider: 'e2e',
        model: 'stub',
        document: {
          antecedentes: 'HTA en tratamiento.',
          historiaEvolucionClinica: 'Traslado por neumonia con oxigenoterapia.',
          examenesComplementarios: 'Radiografia con infiltrado basal derecho.',
          diagnosticosEgreso: 'Neumonia adquirida en la comunidad.',
          planEgreso: 'Continuar ceftriaxona y control de saturacion.',
        },
      }),
    });
  });
};

test.describe('Clinical document AI import E2E smoke', () => {
  test('imports a DOCX through the AI UI flow and keeps the saved draft after reopening', async ({
    page,
  }) => {
    await routeSuccessfulAiImport(page, { assertSourceText: true });

    await openSeededAiImportCensus(page);
    await openClinicalDocumentsFromR1(page);
    await uploadAiImportDocx(page);

    await expect(
      page.getByText(/Se generó y guardó un borrador editable desde traslado-ia\.docx/i)
    ).toBeVisible({
      timeout: 20_000,
    });
    await expectImportedAiDocumentContent(page);

    await page.goto(`/censo?date=${E2E_DATE}`);
    await expect(page.getByTestId('census-table')).toBeVisible({ timeout: 20_000 });
    await openClinicalDocumentsFromR1(page);

    await expectImportedAiDocumentContent(page);
  });

  test('keeps clinician edits to an AI-imported draft after reopening', async ({ page }) => {
    await routeSuccessfulAiImport(page);

    await openSeededAiImportCensus(page);
    await openClinicalDocumentsFromR1(page);
    await uploadAiImportDocx(page, 'traslado-ia-editable.docx');
    await expect(
      page.getByText(/Se generó y guardó un borrador editable desde traslado-ia-editable\.docx/i)
    ).toBeVisible({ timeout: 20_000 });

    const editedPlan = 'Plan editado por medico: retirar oxigeno si satura mayor a 94%.';
    const planEditor = page.getByLabel('Contenido Plan de egreso');
    await planEditor.fill(editedPlan);
    await planEditor.blur();
    await expect(planEditor).toContainText(editedPlan);
    await expect(page.getByText('Cambios locales sin guardar')).toBeHidden({ timeout: 10_000 });
    await expect(page.getByText('Guardando...')).toBeHidden({ timeout: 10_000 });

    await page.goto(`/censo?date=${E2E_DATE}`);
    await expect(page.getByTestId('census-table')).toBeVisible({ timeout: 20_000 });
    await openClinicalDocumentsFromR1(page);

    await expect(page.getByText('Epicrisis traslado').first()).toBeVisible();
    await expect(page.getByText(editedPlan)).toBeVisible();
    await expect(page.getByText('Continuar ceftriaxona y control de saturacion.')).toBeHidden();
  });

  test('prints an AI-imported draft with the generated clinical content', async ({ page }) => {
    await page.addInitScript(() => {
      const browserWindow = window as ClinicalDocumentPrintWindow;
      browserWindow.__clinicalDocumentPrintCalled = false;
      window.print = () => {
        browserWindow.__clinicalDocumentPrintCalled = true;
      };
    });
    await routeSuccessfulAiImport(page);

    await openSeededAiImportCensus(page);
    await openClinicalDocumentsFromR1(page);
    await uploadAiImportDocx(page, 'traslado-ia-print.docx');
    await expect(
      page.getByText(/Se generó y guardó un borrador editable desde traslado-ia-print\.docx/i)
    ).toBeVisible({ timeout: 20_000 });

    await page.getByRole('button', { name: 'Imprimir PDF' }).click();
    await expect(page.locator('#clinical-document-inline-print-root')).toContainText(
      'Traslado por neumonia con oxigenoterapia.'
    );
    await expect(page.locator('#clinical-document-inline-print-root')).toContainText(
      'Continuar ceftriaxona y control de saturacion.'
    );
    await expect
      .poll(() =>
        page.evaluate(() =>
          Boolean((window as ClinicalDocumentPrintWindow).__clinicalDocumentPrintCalled)
        )
      )
      .toBe(true);
  });

  test('shows a controlled AI failure and does not create a draft', async ({ page }) => {
    await page.route('**/.netlify/functions/clinical-document-ai-import', async route => {
      const payload = route.request().postDataJSON() as { sourceText?: string };
      expect(payload.sourceText?.toLowerCase()).toContain('traslado por neumonia');

      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Servicio IA no disponible.' }),
      });
    });

    await openSeededAiImportCensus(page);
    await openClinicalDocumentsFromR1(page);
    await expect(page.getByText('No hay documentos clínicos para este episodio.')).toBeVisible();

    await uploadAiImportDocx(page, 'traslado-ia-falla.docx');

    await expect(
      page.getByText(/La importación se detuvo antes de guardar: Servicio IA no disponible\./i)
    ).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText('No hay documentos clínicos para este episodio.')).toBeVisible();
    await expect(page.getByText('Traslado por neumonia con oxigenoterapia.')).toBeHidden();
  });
});
