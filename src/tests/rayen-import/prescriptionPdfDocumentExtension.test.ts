// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { jsPDF } from 'jspdf';
import * as PDFLib from 'pdf-lib';

import { extractPageText, pdfPrint, prescriptionPdf } from './prescriptionPdfTestHarness';

const { PDFDocument, PDFDict, PDFName } = PDFLib;

describe('extension prescription operations', () => {
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
    const text = (await extractPageText(buffer)).join(' ');
    expect(text).not.toContain('Folio:');
    expect(text).toMatch(/Prescriptor:\s+Elena Díaz/);
    expect(text).toContain('FIRMA');
    expect(text).toContain('Pagina 1 de 1');
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

  it('keeps every patient when merging a nine-prescription compact batch', async () => {
    const sources = Array.from({ length: 9 }, (_, index) =>
      prescriptionPdf.generateProfessionalPrescriptionPdf(
        {
          patient: { name: `Paciente compacto ${index + 1}` },
          professional: 'Elena Díaz',
          validationDate: '2026-07-16',
          emissionDateTime: '16-07-2026 10:00',
          printFormat: 'compact',
          medications: [{ medication: `Medicamento ${index + 1}`, posology: '1 al día' }],
        },
        jsPDF
      )
    );

    const merged = await pdfPrint.mergePdfBuffers(sources, PDFLib);
    const loaded = await PDFDocument.load(merged);
    const text = (await extractPageText(merged)).join(' ');

    expect(loaded.getPageCount()).toBe(9);
    for (let index = 1; index <= 9; index += 1) {
      expect(text).toContain(`Paciente compacto ${index}`);
    }
  });

  it('rejects oversized merge inputs before allocating the combined PDF', async () => {
    const source = prescriptionPdf.generateProfessionalPrescriptionPdf(
      {
        patient: { name: 'Paciente' },
        professional: 'Elena Díaz',
        validationDate: '2026-07-15',
        emissionDateTime: '15-07-2026 08:00',
        medications: [{ medication: 'Paracetamol', posology: '1 cada 8 horas' }],
      },
      jsPDF
    );

    await expect(
      pdfPrint.mergePdfBuffers([source], PDFLib, { maxInputBytes: source.byteLength - 1 })
    ).rejects.toThrow(/tamaño seguro.*menos pacientes/i);
  });

  it('rejects merge batches that exceed the configured safe page count', async () => {
    const first = prescriptionPdf.generateProfessionalPrescriptionPdf(
      {
        patient: { name: 'Paciente uno' },
        professional: 'Elena Díaz',
        validationDate: '2026-07-15',
        emissionDateTime: '15-07-2026 08:00',
        medications: [{ medication: 'Paracetamol', posology: '1 cada 8 horas' }],
      },
      jsPDF
    );
    const second = first.slice(0);

    await expect(
      pdfPrint.mergePdfBuffers([first, second], PDFLib, { maxPages: 1 })
    ).rejects.toThrow(/máximo seguro de 1 páginas.*menos pacientes/i);
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
    const pageCount = (await PDFDocument.load(buffer.slice(0))).getPageCount();
    const text = (await extractPageText(buffer)).join(' ');

    expect(pageCount).toBe(1);
    expect(text).toContain('Despacho Farmacia');
    expect(text).toContain('Pendiente');
    expect(text).toContain('Impreso por Valeria Salfate');
    expect(text).toContain('FIRMA');
    expect(text).toContain('Pagina 1 de 1');
  });

  it('starts a second official-equivalent compact page at medication 23', async () => {
    const buffer = createOfficialEquivalentCompact(23);
    const pageCount = (await PDFDocument.load(buffer.slice(0))).getPageCount();
    const pages = await extractPageText(buffer);

    expect(pageCount).toBe(2);
    expect(pages).toHaveLength(2);
    expect(pages[0]).toContain('Pagina 1 de 2');
    expect(pages[1]).toContain('Pagina 2 de 2');
    expect(pages[1]).toContain('Medicamento oficial 23');
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
});
