import { beforeEach, describe, expect, it, vi } from 'vitest';
import { generateHandoffPdf } from '@/services/pdf/handoffPdfGenerator';
import { openPdfPrintDialog } from '@/services/pdf/pdfBase';
import { addNovedadesSection } from '@/services/pdf/handoffPdfSections';
import { HANDOFF_PDF_PAGE_LAYOUT } from '@/services/pdf/handoffPdfPageLayout';

const docMock = {
  output: vi.fn(() => new ArrayBuffer(8)),
};

const jsPdfConstructorMock = vi.hoisted(() => vi.fn());

vi.mock('jspdf', () => ({
  default: vi.fn(
    class {
      constructor(options?: unknown) {
        jsPdfConstructorMock(options);
      }

      output = docMock.output;
    }
  ),
}));

vi.mock('jspdf-autotable', () => ({
  default: vi.fn(),
}));

vi.mock('@/services/pdf/pdfBase', () => ({
  openPdfPrintDialog: vi.fn(),
}));

vi.mock('@/services/pdf/handoffPdfSections', () => ({
  addHandoffHeader: vi.fn(async () => 20),
  addStaffAndChecklist: vi.fn(() => 40),
  addPatientTable: vi.fn(() => 80),
  addMovementsSummary: vi.fn(() => 120),
  addNovedadesSection: vi.fn(),
  addCudyrTable: vi.fn(),
  addPageFooter: vi.fn(),
}));

describe('handoffPdfGenerator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    jsPdfConstructorMock.mockClear();
  });

  it('opens the browser print dialog for a nursing day-shift export', async () => {
    await generateHandoffPdf(
      {
        date: '2026-01-03',
        handoffNovedadesDayShift: '',
        handoffNovedadesNightShift: '',
      } as never,
      false,
      'day',
      {
        dayStart: '08:00',
        dayEnd: '20:00',
        nightStart: '20:00',
        nightEnd: '08:00',
      }
    );

    expect(docMock.output).toHaveBeenCalledWith('arraybuffer');
    expect(jsPdfConstructorMock).toHaveBeenCalledWith({
      orientation: 'portrait',
      unit: 'mm',
      format: 'a4',
      compress: true,
    });
    expect(openPdfPrintDialog).toHaveBeenCalledWith(
      expect.any(Uint8Array),
      '03-01-2026 - Turno Largo.pdf'
    );
  });

  it('uses the night-shift file name for nocturnal nursing print exports', async () => {
    await generateHandoffPdf(
      {
        date: '2026-01-03',
        handoffNovedadesDayShift: '',
        handoffNovedadesNightShift: '',
      } as never,
      false,
      'night',
      {
        dayStart: '08:00',
        dayEnd: '20:00',
        nightStart: '20:00',
        nightEnd: '08:00',
      }
    );

    expect(openPdfPrintDialog).toHaveBeenCalledWith(
      expect.any(Uint8Array),
      '03-01-2026 - Turno Noche.pdf'
    );
  });

  it('opens the browser print dialog for medical exports too', async () => {
    await generateHandoffPdf(
      {
        date: '2026-01-03',
        handoffNovedadesDayShift: '',
        handoffNovedadesNightShift: '',
      } as never,
      true,
      'day',
      {
        dayStart: '08:00',
        dayEnd: '20:00',
        nightStart: '20:00',
        nightEnd: '08:00',
      }
    );

    expect(openPdfPrintDialog).toHaveBeenCalledWith(
      expect.any(Uint8Array),
      '03-01-2026 - Turno Largo.pdf'
    );
  });

  it('passes night novedades into the PDF layout for nocturnal exports', async () => {
    await generateHandoffPdf(
      {
        date: '2026-01-03',
        handoffNovedadesDayShift: 'Dia',
        handoffNovedadesNightShift: 'Noche con novedades',
      } as never,
      false,
      'night',
      {
        dayStart: '08:00',
        dayEnd: '20:00',
        nightStart: '20:00',
        nightEnd: '08:00',
      }
    );

    expect(addNovedadesSection).toHaveBeenCalledWith(
      expect.anything(),
      'Noche con novedades',
      expect.any(Number),
      expect.any(Number),
      HANDOFF_PDF_PAGE_LAYOUT.margin
    );
  });

  it('falls back to day novedades for nocturnal exports when night text is empty', async () => {
    await generateHandoffPdf(
      {
        date: '2026-01-03',
        handoffNovedadesDayShift: 'Texto heredado del turno largo',
        handoffNovedadesNightShift: '',
      } as never,
      false,
      'night',
      {
        dayStart: '08:00',
        dayEnd: '20:00',
        nightStart: '20:00',
        nightEnd: '08:00',
      }
    );

    expect(addNovedadesSection).toHaveBeenCalledWith(
      expect.anything(),
      'Texto heredado del turno largo',
      expect.any(Number),
      expect.any(Number),
      HANDOFF_PDF_PAGE_LAYOUT.margin
    );
  });
});
