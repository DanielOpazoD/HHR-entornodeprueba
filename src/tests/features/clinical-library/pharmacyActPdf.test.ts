// @vitest-environment node
import { readFileSync } from 'node:fs';
import { PDFArray, PDFDocument, PDFRawStream, decodePDFRawStream } from 'pdf-lib';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createPharmacyDraft,
  createPharmacyLine,
} from '@/features/clinical-library/domain/pharmacy/pharmacyDraft';
import type { PharmacyActDraft } from '@/features/clinical-library/domain/pharmacy/pharmacyTypes';
import {
  createPharmacyActPdf,
  generatePharmacyActPdf,
} from '@/features/clinical-library/services/pharmacyActPdf';

const logo = new Uint8Array(readFileSync('public/images/logos/logo_HHR.png'));
const draft = (
  kind: PharmacyActDraft['kind'] = 'return',
  paperSize: PharmacyActDraft['paperSize'] = 'a4'
): PharmacyActDraft => ({
  ...createPharmacyDraft(kind, {
    name: 'Profesional Álvarez',
    rut: '11.111.111-1',
    role: 'Enfermería',
    unit: 'Hospitalizados',
  }),
  paperSize,
  date: '2026-10-22',
  number: '7/2026',
  lines: [
    {
      ...createPharmacyLine(),
      medicationId: 'manual',
      name: 'Ácido de prueba 10 mg',
      presentation: 'Comprimido',
      quantity: '2,5',
      patient: 'PACIENTE SINTÉTICO',
      reason: 'Sobre stock',
      expiry: '2025-12-31',
      disposalCause: 'expired',
    },
  ],
});

const pageText = (pdf: PDFDocument, pageNumber: number): string => {
  const contents = pdf.getPage(pageNumber).node.Contents();
  const objects =
    contents instanceof PDFArray
      ? contents.asArray().map(ref => pdf.context.lookup(ref))
      : [contents];
  return objects
    .filter((value): value is PDFRawStream => value instanceof PDFRawStream)
    .map(value => Buffer.from(decodePDFRawStream(value).decode()).toString('latin1'))
    .join('\n');
};
const pdfText = (pdf: PDFDocument): string =>
  pdf
    .getPages()
    .map((_, index) => pageText(pdf, index))
    .join('\n');
const hex = (text: string): string => Buffer.from(text, 'latin1').toString('hex').toUpperCase();
const paperSizes = [
  { paperSize: 'a4', width: 595.28, height: 841.89 },
  { paperSize: 'letter', width: 612, height: 792 },
] satisfies Array<{ paperSize: PharmacyActDraft['paperSize']; width: number; height: number }>;
const actKinds: PharmacyActDraft['kind'][] = ['return', 'disposal'];

afterEach(() => vi.unstubAllGlobals());

describe('pharmacy act PDF', () => {
  it.each(paperSizes.flatMap(paper => actKinds.map(kind => ({ ...paper, kind }))))(
    'prints $kind in portrait $paperSize with original columns and a real institutional logo',
    async ({ kind, paperSize, width, height }) => {
      const values = draft(kind, paperSize);
      const pdf = await PDFDocument.load(await createPharmacyActPdf(values, logo));
      expect(pdf.getPageCount()).toBe(1);
      expect(pdf.getPage(0).getWidth()).toBeCloseTo(width);
      expect(pdf.getPage(0).getHeight()).toBeCloseTo(height);
      expect(pdf.getPage(0).getWidth()).toBeLessThan(pdf.getPage(0).getHeight());
      const operators = pdfText(pdf);
      for (const value of [
        values.professional.name,
        values.professional.rut,
        values.professional.role,
        values.professional.unit,
        values.recipient,
        values.number,
        '22/10/2026',
        values.lines[0].name,
        values.lines[0].quantity,
        values.lines[0].presentation,
        '31/12/2025',
        values.lines[0].reason,
      ])
        expect(operators, value).toContain(hex(value));
      expect(operators).toContain(' Do');
      expect(operators).toContain(hex('Firma de quien entrega'));
      expect(operators).toContain(hex('Recibe conforme'));
      expect(operators).toContain(hex(kind === 'return' ? 'Fundamento' : 'CAUSA DE ELIMINACIÓN'));
      expect(pdf.getForm().getFields()).toHaveLength(0);
    }
  );

  it.each(paperSizes)(
    'paginates $paperSize with repeated headings and keeps the last record',
    async ({ paperSize, width, height }) => {
      const values = draft('disposal', paperSize);
      values.lines = Array.from({ length: 80 }, (_, index) => ({
        ...values.lines[0],
        id: `line-${index}`,
        name: `Fármaco sintético registro ${index + 1}`,
        quantity: String(index + 1),
      }));
      const pdf = await PDFDocument.load(await createPharmacyActPdf(values, logo));
      expect(pdf.getPageCount()).toBeGreaterThan(4);
      const operators = pdfText(pdf);
      expect(operators).toContain(hex('registro 80'));
      pdf.getPages().forEach((page, index) => {
        expect(page.getWidth()).toBeCloseTo(width);
        expect(page.getHeight()).toBeCloseTo(height);
        expect(pageText(pdf, index)).toContain(hex('HOSPITAL HANGA ROA'));
        expect(pageText(pdf, index)).toContain(hex(`gina ${index + 1} de ${pdf.getPageCount()}`));
      });
    }
  );

  it.each(paperSizes)(
    'continues a long $paperSize row across pages and wraps unbroken names without losing the tail',
    async ({ paperSize, width, height }) => {
      const values = draft('return', paperSize);
      values.lines[0].name = 'A'.repeat(600) + ' FINMED';
      values.lines[0].reason = 'Fundamento prolongado de prueba. '.repeat(300) + 'ULTIMO-REGISTRO';
      const pdf = await PDFDocument.load(await createPharmacyActPdf(values, logo));
      expect(pdf.getPageCount()).toBeGreaterThan(3);
      expect(pdfText(pdf)).toContain(hex('FINMED'));
      expect(pdfText(pdf)).toContain(hex('ULTIMO-REGISTRO'));
      expect(pdfText(pdf)).toContain(hex('continuación del registro 1'));
      pdf.getPages().forEach(page => {
        expect(page.getWidth()).toBeCloseTo(width);
        expect(page.getHeight()).toBeCloseTo(height);
      });
    }
  );

  it('rejects an unsupported paper size before generating a PDF', async () => {
    const values = draft();
    Object.assign(values, { paperSize: 'legal' });
    await expect(createPharmacyActPdf(values, logo)).rejects.toThrow('tamaño de papel válido');
  });

  it('rejects invalid runtime kinds, elimination causes and future expired-product dates before printing', async () => {
    const invalidKind = draft();
    Object.assign(invalidKind, { kind: 'other' });
    await expect(createPharmacyActPdf(invalidKind, logo)).rejects.toThrow('tipo de acta válido');
    const invalidCause = draft('disposal');
    Object.assign(invalidCause.lines[0], { disposalCause: 'other' });
    await expect(createPharmacyActPdf(invalidCause, logo)).rejects.toThrow('causa de eliminación');
    const futureExpired = draft('disposal');
    futureExpired.lines[0].expiry = '2027-01-31';
    await expect(createPharmacyActPdf(futureExpired, logo)).rejects.toThrow(
      'no puede ser posterior'
    );
  });

  it('rejects invalid drafts and unsupported Unicode instead of omitting values', async () => {
    const values = draft();
    values.lines[0].quantity = '-2';
    await expect(createPharmacyActPdf(values, logo)).rejects.toThrow('mayor que cero');
    values.lines[0].quantity = '2';
    values.lines[0].name += ' 🧪';
    await expect(createPharmacyActPdf(values, logo)).rejects.toThrow('caracteres');
  });

  it('uses the public logo and surfaces a failed asset request', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(logo));
    vi.stubGlobal('fetch', fetchMock);
    const bytes = await generatePharmacyActPdf(draft());
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(1);
    expect(fetchMock).toHaveBeenCalledWith('/images/logos/logo_HHR.png');
    fetchMock.mockResolvedValue(new Response('', { status: 404 }));
    await expect(generatePharmacyActPdf(draft())).rejects.toThrow('logo institucional');
  });
});
