import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createClinicalDocumentDraft } from '@/features/clinical-documents/domain/factories';
import type { ClinicalDocumentRecord } from '@/features/clinical-documents/domain/entities';
import { generateClinicalDocumentPdfBlob } from '@/features/clinical-documents/services/clinicalDocumentPdfService';

const generatePrintStyledPdfBlobMock = vi.fn();
const pdfTextCalls: string[] = [];

vi.mock('@/features/clinical-documents/services/clinicalDocumentPrintPdfService', () => ({
  generateClinicalDocumentPrintStyledPdfBlob: (...args: unknown[]) =>
    generatePrintStyledPdfBlobMock(...args),
}));

vi.mock('jspdf', () => {
  class MockJsPdf {
    internal = {
      pageSize: {
        getWidth: () => 216,
        getHeight: () => 279,
      },
    };

    addPage = vi.fn();
    setFont = vi.fn();
    setFontSize = vi.fn();
    splitTextToSize = vi.fn((text: string) => [text]);
    text = vi.fn((text: string) => {
      pdfTextCalls.push(text);
    });
    output = vi.fn(() => new Blob(['structured-pdf'], { type: 'application/pdf' }));
  }

  return { jsPDF: MockJsPdf };
});

const buildRecord = (): ClinicalDocumentRecord => ({
  ...createClinicalDocumentDraft({
    templateId: 'epicrisis',
    hospitalId: 'hhr',
    actor: {
      uid: 'u1',
      email: 'doctor@test.com',
      displayName: 'Doctor Test',
      role: 'doctor_urgency',
    },
    episode: {
      patientRut: '11.111.111-1',
      patientName: 'Paciente Test',
      episodeKey: '11.111.111-1__2026-03-06',
      admissionDate: '2026-03-06',
      sourceDailyRecordDate: '2026-03-06',
      sourceBedId: 'R1',
      specialty: 'Medicina',
    },
    patientFieldValues: {
      nombre: 'Paciente Test',
      rut: '11.111.111-1',
      edad: '40',
      fecnac: '1986-01-01',
      fing: '2026-03-01',
      finf: '2026-03-06',
      hinf: '10:30',
    },
    medico: 'Doctor Test',
    especialidad: 'Medicina',
  }),
  patientFields: [
    { id: 'finf', label: 'Fecha del informe', value: '2026-03-06', type: 'date' },
    { id: 'rut', label: 'RUT', value: '11.111.111-1', type: 'text' },
    { id: 'vacio', label: 'Campo vacío', value: '', type: 'text' },
  ],
  sections: [
    { id: 's1', title: 'Resumen', content: '<b>Alta</b><div>Sin complicaciones</div>', order: 1 },
  ],
});

describe('clinicalDocumentPdfService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    pdfTextCalls.length = 0;
  });

  it('returns the print-styled blob when available', async () => {
    const styledBlob = new Blob(['styled'], { type: 'application/pdf' });
    generatePrintStyledPdfBlobMock.mockResolvedValueOnce(styledBlob);

    const result = await generateClinicalDocumentPdfBlob(buildRecord());

    expect(result).toBe(styledBlob);
  });

  it('falls back to a structured pdf when the print-styled generation fails', async () => {
    generatePrintStyledPdfBlobMock.mockRejectedValueOnce(new Error('print failed'));

    const result = await generateClinicalDocumentPdfBlob(buildRecord());

    expect(result).toBeInstanceOf(Blob);
    expect(result.size).toBeGreaterThan(0);
  });

  it('renames the epicrisis report date label and normalizes patient fields', async () => {
    generatePrintStyledPdfBlobMock.mockResolvedValueOnce(null);

    await generateClinicalDocumentPdfBlob(buildRecord());

    expect(pdfTextCalls.some(text => text.includes('Fecha de alta: 2026-03-06'))).toBe(true);
    expect(pdfTextCalls).toContain('Campo vacío: —');
    expect(pdfTextCalls).toContain('Resumen');
    expect(pdfTextCalls.some(text => text.includes('Alta'))).toBe(true);
  });

  it('renders only the annex header and content for annex-only structured PDFs', async () => {
    generatePrintStyledPdfBlobMock.mockResolvedValueOnce(null);
    const record = buildRecord();
    record.annexContent = '<p>Anexo de evolución</p>';

    await generateClinicalDocumentPdfBlob(record, { annexMode: 'annex_only' });

    expect(pdfTextCalls).toContain('Anexo del documento');
    expect(pdfTextCalls.some(text => text.includes('Paciente: Paciente Test'))).toBe(true);
    expect(pdfTextCalls.some(text => text.includes('Anexo de evolución'))).toBe(true);
    expect(pdfTextCalls).not.toContain(record.title);
  });

  it('omits annex content from structured PDFs when annexMode is exclude', async () => {
    generatePrintStyledPdfBlobMock.mockResolvedValueOnce(null);
    const record = buildRecord();
    record.annexContent = '<p>Anexo omitido</p>';

    await generateClinicalDocumentPdfBlob(record, { annexMode: 'exclude' });

    expect(pdfTextCalls).not.toContain('Anexo del documento');
    expect(pdfTextCalls.some(text => text.includes('Anexo omitido'))).toBe(false);
  });
});
