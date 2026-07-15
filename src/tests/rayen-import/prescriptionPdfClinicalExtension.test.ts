// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { jsPDF } from 'jspdf';
import * as PDFLib from 'pdf-lib';

import { extractPageText, pdfPrint, prescriptionPdf } from './prescriptionPdfTestHarness';

const { PDFDocument, PDFDict, PDFName } = PDFLib;

describe('extension prescription operations', () => {
  it('creates a paginated BRADEN appendix for hospitalized patients', async () => {
    const patients = Array.from({ length: 30 }, (_, index) => ({
      name: `Paciente hospitalizado ${index + 1}`,
      run: `12.345.${String(index).padStart(3, '0')}-K`,
      bed: `H${Math.floor(index / 4) + 1}C${(index % 4) + 1}`,
      braden:
        index % 5 === 0
          ? null
          : {
              total: 14 + (index % 7),
              severity: index % 2 ? 'Riesgo moderado' : 'Riesgo bajo',
              dateTime: '2026-07-15T08:40:00-04:00',
              author: 'Valeria Salfate',
            },
    }));
    const buffer = prescriptionPdf.generateBradenSummaryPdf(
      { patients, generatedAt: '2026-07-15T09:10:00' },
      jsPDF
    );
    const loaded = await PDFDocument.load(buffer);

    expect(buffer.byteLength).toBeGreaterThan(3_000);
    expect(loaded.getPageCount()).toBeGreaterThan(1);
  });

  it('fails closed instead of clipping an oversized BRADEN row', () => {
    expect(() =>
      prescriptionPdf.generateBradenSummaryPdf(
        {
          generatedAt: '2026-07-15T09:10:00',
          patients: [
            {
              name: 'Paciente de prueba',
              run: '8.932.066-6',
              bed: 'H6C1',
              braden: {
                total: 12,
                severity: 'Riesgo alto',
                dateTime: '2026-07-15T08:40:00-06:00',
                author: 'Profesional ' + 'con identificación extensa '.repeat(8_000),
              },
            },
          ],
        },
        jsPDF
      )
    ).toThrow(/fila de BRADEN.*sin pérdida/i);
  });

  it('creates one integrated regimen and BRADEN table with repeated pages for long censuses', async () => {
    const patients = Array.from({ length: 28 }, (_, index) => ({
      name: `Paciente hospitalizado ${index + 1}`,
      run: `12.345.${String(index).padStart(3, '0')}-K`,
      service: 'Área Médico Quirúrgica Indiferenciada',
      room: `Habitación ${Math.floor(index / 4) + 1}`,
      bed: `H${Math.floor(index / 4) + 1}C${(index % 4) + 1}`,
      regimen:
        index % 6 === 0
          ? null
          : {
              diet: index % 2 ? 'Común' : 'Papilla',
              observation:
                index % 4 === 0
                  ? 'Alimentación asistida, posición sentada a 90 grados y asegurar deglución completa.'
                  : 'Diabético',
              dateTime: '2026-07-15T08:10:00-06:00',
            },
      braden:
        index % 5 === 0
          ? null
          : {
              total: 14 + (index % 7),
              severity: index % 2 ? 'Riesgo moderado' : 'Riesgo bajo',
              dateTime: '2026-07-15T08:40:00-06:00',
              author: 'Valeria Salfate',
            },
    }));
    const buffer = prescriptionPdf.generateIntegratedRegimenPdf(
      { patients, generatedAt: '2026-07-15T09:10:00' },
      jsPDF
    );
    const loaded = await PDFDocument.load(buffer);
    const firstPage = loaded.getPage(0);
    const pageTexts = await extractPageText(buffer.slice(0));
    const allText = pageTexts.join(' ');
    const requiredHeaders = [
      'SERVICIO',
      'CAMA',
      'PACIENTE / RUN',
      'RÉGIMEN',
      'OBSERVACIÓN',
      'FECHA RÉGIMEN',
      'VALOR BRADEN',
      'CLASIFICACIÓN',
      'FECHA ESCALA BRADEN',
    ];

    expect(buffer.byteLength).toBeGreaterThan(5_000);
    expect(loaded.getPageCount()).toBeGreaterThan(1);
    expect(firstPage.getWidth()).toBeGreaterThan(firstPage.getHeight());
    for (const pageText of pageTexts) {
      for (const header of requiredHeaders) expect(pageText).toContain(header);
    }
    expect(allText).toContain('Paciente hospitalizado 2');
    expect(allText).toContain('12.345.001-K');
    expect(allText).toContain('Común');
    expect(allText).toContain('Diabético');
    expect(allText).toContain('Riesgo moderado');
    expect(allText).toContain('15-07-2026 08:40');

    const printable = await pdfPrint.preparePdfForBrowserPrint(buffer, PDFLib);
    const printableDocument = await PDFDocument.load(printable);
    const action = printableDocument.catalog.lookup(PDFName.of('OpenAction'), PDFDict);
    expect(action.lookup(PDFName.of('N'))?.toString()).toBe('/Print');
  });

  it('fails closed instead of clipping an oversized regimen row', () => {
    expect(() =>
      prescriptionPdf.generateIntegratedRegimenPdf(
        {
          generatedAt: '2026-07-15T09:10:00',
          patients: [
            {
              name: 'Paciente de prueba',
              run: '8.932.066-6',
              service: 'AMQI',
              room: 'H6',
              bed: 'H6C1',
              regimen: {
                diet: 'Común',
                observation: 'Observación clínica extensa ' + 'contenido '.repeat(8_000),
                dateTime: '2026-07-15T08:10:00-06:00',
              },
              braden: {
                total: 14,
                severity: 'Riesgo moderado',
                dateTime: '2026-07-15T08:40:00-06:00',
                author: 'Valeria Salfate',
              },
            },
          ],
        },
        jsPDF
      )
    ).toThrow(/fila de régimen.*sin pérdida/i);
  });
});
