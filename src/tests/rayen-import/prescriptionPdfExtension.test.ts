// @vitest-environment node
import path from 'node:path';

import { describe, expect, it } from 'vitest';
import { jsPDF } from 'jspdf';
import * as PDFLib from 'pdf-lib';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

import '../../../extension/prescription-pdf.js';
import '../../../extension/pdf-print.js';

const { PDFDocument, PDFDict, PDFName } = PDFLib;
const standardFontDataUrl = path.resolve('node_modules/pdfjs-dist/standard_fonts') + path.sep;

const prescriptionPdf = (
  globalThis as typeof globalThis & {
    HhrPrescriptionPdf: {
      generateProfessionalPrescriptionPdf: (
        data: {
          patient: Record<string, string>;
          professional: string;
          professionalRun?: string;
          validationDate: string;
          validationDateTime?: string;
          dateSource?: 'validation' | 'indication';
          emissionDateTime?: string;
          folio?: string;
          printedBy?: string;
          address?: string;
          officialEquivalent?: boolean;
          isExternalPrescription?: boolean;
          printFormat?: string;
          medications: Array<Record<string, string>>;
        },
        constructor: typeof jsPDF
      ) => ArrayBuffer;
      generateBradenSummaryPdf: (
        data: {
          generatedAt: string;
          patients: Array<{
            name: string;
            run: string;
            bed: string;
            braden: null | {
              total: number;
              severity: string;
              dateTime: string;
              author: string;
            };
          }>;
        },
        constructor: typeof jsPDF
      ) => ArrayBuffer;
      generateIntegratedRegimenPdf: (
        data: {
          generatedAt: string;
          patients: Array<{
            name: string;
            run: string;
            service: string;
            room: string;
            bed: string;
            regimen: null | { diet: string; observation: string; dateTime: string };
            braden: null | { total: number; severity: string; dateTime: string; author: string };
          }>;
        },
        constructor: typeof jsPDF
      ) => ArrayBuffer;
    };
  }
).HhrPrescriptionPdf;

const pdfPrint = (
  globalThis as typeof globalThis & {
    HhrPdfPrint: {
      preparePdfForBrowserPrint: (
        buffer: ArrayBuffer,
        library: typeof PDFLib
      ) => Promise<ArrayBuffer>;
      mergePdfBuffers: (buffers: ArrayBuffer[], library: typeof PDFLib) => Promise<ArrayBuffer>;
    };
  }
).HhrPdfPrint;

const extractPageText = async (buffer: ArrayBuffer) => {
  const pdf = await getDocument({
    data: new Uint8Array(buffer),
    standardFontDataUrl,
    useWorkerFetch: false,
  }).promise;
  return Promise.all(
    Array.from({ length: pdf.numPages }, async (_, index) => {
      const page = await pdf.getPage(index + 1);
      const content = await page.getTextContent();
      return content.items.map(item => ('str' in item ? item.str : '')).join(' ');
    })
  );
};

describe('extension professional prescription PDF', () => {
  it('creates a valid folio-free professional PDF without needing browser globals', async () => {
    const buffer = prescriptionPdf.generateProfessionalPrescriptionPdf(
      {
        patient: {
          name: 'Paciente de prueba',
          run: '12.345.678-9',
          sex: 'Mujer',
          age: '60 años',
          bed: 'H6C1',
          room: 'Habitación 6',
          service: 'Área Médico Quirúrgica Indiferenciada',
          diagnosis: 'Diagnóstico de prueba',
        },
        professional: 'Elena Díaz',
        professionalRun: '17.752.753-K',
        validationDate: '2026-07-14',
        validationDateTime: '2026-07-14T21:30:00-04:00',
        emissionDateTime: '14-07-2026 21:45',
        folio: '012D5533',
        printFormat: 'compact',
        medications: [
          {
            medication: 'Tramadol 100 mg/ml gotas',
            posology: '10 gotas cada 8 horas SOS',
            route: 'Oral',
            note: 'Administrar en caso de dolor',
            date: '2026-07-14',
          },
        ],
      },
      jsPDF
    );

    expect(buffer.byteLength).toBeGreaterThan(1_000);
    expect(new TextDecoder('latin1').decode(buffer.slice(0, 4))).toBe('%PDF');
    expect((await extractPageText(buffer)).join(' ')).not.toContain('Folio:');
  });

  it('labels an individually generated external prescription', async () => {
    const buffer = prescriptionPdf.generateProfessionalPrescriptionPdf(
      {
        patient: { name: 'Paciente de prueba', run: '12.345.678-9' },
        professional: 'Claudia Aravena',
        professionalRun: '17.752.753-K',
        validationDate: '2026-07-15',
        validationDateTime: '2026-07-15T09:00:00-06:00',
        emissionDateTime: '15-07-2026 09:05',
        isExternalPrescription: true,
        medications: [
          {
            medication: 'Mometasona Furoato 50 mcg/dosis Suspensión Nasal',
            posology: '1 puff en cada fosa nasal al día',
            route: 'Inhalatoria nasal',
          },
        ],
      },
      jsPDF
    );

    const text = (await extractPageText(buffer)).join(' ');
    expect(text).toContain('Receta médica externa');
    expect(text).toContain('Mometasona Furoato');
    expect(text).not.toContain('Folio:');
  });

  it('prints personalized prescription times in Pacific/Easter and includes a valid age', async () => {
    const buffer = prescriptionPdf.generateProfessionalPrescriptionPdf(
      {
        patient: {
          name: 'Kevin Villagran Iturra',
          run: '20.189.620-7',
          sex: 'Masculino',
          age: '35 años, 11 meses, 29 días',
          bed: 'R3',
          room: 'Recu3',
          service: 'AMQI',
        },
        professional: 'Angelica Vargas',
        professionalRun: '17.046.496-6',
        validationDate: '2026-07-15',
        validationDateTime: '2026-07-15T14:56:00Z',
        dateSource: 'indication',
        emissionDateTime: '15-07-2026 10:22',
        medications: [
          {
            medication: 'Quetiapina 25 mg Comprimidos',
            posology: '1 Comprimido cada 8 Horas',
            route: 'Oral',
            dateTime: '2026-07-15T14:56:00Z',
          },
        ],
      },
      jsPDF
    );

    const text = (await extractPageText(buffer)).join(' ');
    expect(text).toContain('15-07-2026 08:56');
    expect(text).toContain('35 años, 11 meses, 29 días');
    expect(text).toContain('Fecha indicación:');
    expect(text).not.toContain('15-07-2026 14:56');
    expect(text).not.toContain('Edad: 0 0');
  });

  it('adds the PDF print OpenAction used by the Chrome viewer', async () => {
    const source = prescriptionPdf.generateProfessionalPrescriptionPdf(
      {
        patient: { name: 'Paciente' },
        professional: 'Elena Díaz',
        professionalRun: '17.752.753-K',
        validationDate: '2026-07-14',
        emissionDateTime: '14-07-2026 21:45',
        medications: [{ medication: 'Paracetamol', posology: '1 cada 8 horas' }],
      },
      jsPDF
    );
    const printable = await pdfPrint.preparePdfForBrowserPrint(source, PDFLib);
    const loaded = await PDFDocument.load(printable);
    const action = loaded.catalog.lookup(PDFName.of('OpenAction'), PDFDict);

    expect(action.lookup(PDFName.of('S'))?.toString()).toBe('/Named');
    expect(action.lookup(PDFName.of('N'))?.toString()).toBe('/Print');
  });

  it('merges selected patient prescriptions into one printable document', async () => {
    const first = prescriptionPdf.generateProfessionalPrescriptionPdf(
      {
        patient: { name: 'Paciente uno' },
        professional: 'Elena Díaz',
        validationDate: '2026-07-14',
        emissionDateTime: '14-07-2026 21:45',
        medications: [{ medication: 'Paracetamol', posology: '1 cada 8 horas' }],
      },
      jsPDF
    );
    const second = prescriptionPdf.generateProfessionalPrescriptionPdf(
      {
        patient: { name: 'Paciente dos' },
        professional: 'Daniel Opazo',
        validationDate: '2026-07-15',
        emissionDateTime: '15-07-2026 08:10',
        medications: [{ medication: 'Losartán', posology: '1 al día' }],
      },
      jsPDF
    );

    const merged = await pdfPrint.mergePdfBuffers([first, second], PDFLib);
    const printable = await pdfPrint.preparePdfForBrowserPrint(merged, PDFLib);
    const loaded = await PDFDocument.load(printable);

    expect(loaded.getPageCount()).toBe(2);
    expect(
      loaded.catalog.lookup(PDFName.of('OpenAction'), PDFDict).lookup(PDFName.of('N'))?.toString()
    ).toBe('/Print');
  });

  it('fits materially more medications per page in compact format', async () => {
    const medications = Array.from({ length: 20 }, (_, index) => ({
      medication: `Medicamento ${index + 1} 500 mg Comprimidos`,
      posology: '1 comprimido cada 12 horas',
      route: 'Oral',
      note: '',
      date: '2026-07-14',
    }));
    const common = {
      patient: {
        name: 'Paciente de prueba',
        run: '12.345.678-9',
        sex: 'Mujer',
        age: '60 años',
        bed: 'H6C1',
        room: 'Habitación 6',
        service: 'Área Médico Quirúrgica Indiferenciada',
        diagnosis: 'Diagnóstico de prueba',
      },
      professional: 'Elena Díaz',
      professionalRun: '17.752.753-K',
      validationDate: '2026-07-14',
      validationDateTime: '2026-07-14T21:30:00-04:00',
      emissionDateTime: '14-07-2026 21:45',
      medications,
    };
    const standard = prescriptionPdf.generateProfessionalPrescriptionPdf(
      { ...common, printFormat: 'standard' },
      jsPDF
    );
    const compact = prescriptionPdf.generateProfessionalPrescriptionPdf(
      { ...common, printFormat: 'compact' },
      jsPDF
    );
    const standardPages = (await PDFDocument.load(standard)).getPageCount();
    const compactPages = (await PDFDocument.load(compact)).getPageCount();

    expect(standardPages).toBe(2);
    expect(compactPages).toBe(1);
  });

  const createOfficialEquivalentCompact = (medicationCount: number) => {
    const medications = Array.from({ length: medicationCount }, (_, index) => ({
      medication: `Medicamento oficial ${index + 1} 500 mg Comprimidos , vía oral`,
      posology:
        index % 5 === 0 ? '2 comprimidos cada 8 horas en caso de dolor' : '1 comprimido al día',
      dispatch: index === 0 ? 'Pendiente' : '',
      dateTime: '09-07-2026 11:15',
    }));

    return prescriptionPdf.generateProfessionalPrescriptionPdf(
      {
        patient: {
          name: 'Paciente de prueba',
          run: '12.345.678-9',
          sex: 'Mujer',
          age: '60 año(s)',
          bed: 'H6C1',
          room: 'Habitacion 6',
          service: 'Área Médico Quirúrgica Indiferenciada',
          diagnosis: '',
        },
        professional: 'Elena Díaz',
        professionalRun: '17.752.753-K',
        validationDate: '15-07-2026',
        emissionDateTime: '14-07-2026 23:23',
        folio: 'D292620E',
        printedBy: 'Valeria Salfate',
        address: 'Simón Paoa N°S/N - Fono 322578361',
        officialEquivalent: true,
        printFormat: 'compact',
        medications,
      },
      jsPDF
    );
  };

  it('keeps up to 22 medications on one official-equivalent compact page', async () => {
    const buffer = createOfficialEquivalentCompact(22);

    expect((await PDFDocument.load(buffer)).getPageCount()).toBe(1);
    expect((await extractPageText(buffer)).join(' ')).toContain('Pendiente');
  });

  it('starts a second official-equivalent compact page at medication 23', async () => {
    const buffer = createOfficialEquivalentCompact(23);

    expect((await PDFDocument.load(buffer)).getPageCount()).toBe(2);
  });

  it('fails closed instead of clipping a medication row taller than a fresh page', () => {
    expect(() =>
      prescriptionPdf.generateProfessionalPrescriptionPdf(
        {
          patient: { name: 'Paciente de prueba' },
          professional: 'Elena Díaz',
          validationDate: '2026-07-15',
          emissionDateTime: '15-07-2026 08:00',
          printFormat: 'compact',
          medications: [
            {
              medication: 'Medicamento extremadamente extenso ' + 'contenido '.repeat(6_000),
              posology: '1 vez al día',
            },
          ],
        },
        jsPDF
      )
    ).toThrow(/demasiado extensa.*sin pérdida/i);
  });

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
