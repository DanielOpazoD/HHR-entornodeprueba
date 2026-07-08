import { describe, expect, it, vi } from 'vitest';

import { addMovementsSummary } from '@/services/pdf/handoffPdfMovementsSummarySection';
import { HANDOFF_PDF_PAGE_LAYOUT } from '@/services/pdf/handoffPdfPageLayout';
import type { DailyRecord } from '@/types/domain/dailyRecord';

const createDocMock = () =>
  ({
    setFont: vi.fn(),
    setFontSize: vi.fn(),
    text: vi.fn(),
    addPage: vi.fn(),
    setDrawColor: vi.fn(),
    setLineWidth: vi.fn(),
    line: vi.fn(),
    internal: { pageSize: { height: 297, width: 210 } },
    lastAutoTable: { finalY: 100 },
  }) as never;

describe('handoffPdfMovementsSummarySection', () => {
  it('keeps only spacing between altas, traslados and hospitalización diurna blocks', () => {
    const doc = createDocMock();
    const autoTable = vi.fn(() => {
      (doc as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY += 12;
    });
    const record = {
      discharges: [
        {
          bedName: 'A1',
          patientName: 'Alta uno',
          diagnosis: 'Dx alta',
          status: 'Vivo',
          dischargeType: 'Domicilio',
        },
      ],
      transfers: [
        {
          bedName: 'A2',
          patientName: 'Traslado uno',
          diagnosis: 'Dx traslado',
          receivingCenter: 'Hospital Base',
          evacuationMethod: 'Ambulancia',
        },
      ],
      cma: [
        {
          patientName: 'CMA uno',
          rut: '1-9',
          diagnosis: 'Procedimiento',
          interventionType: 'CMA',
        },
      ],
    } as unknown as DailyRecord;

    addMovementsSummary(doc, record, 14, 100, autoTable as never);

    expect((doc as { line: ReturnType<typeof vi.fn> }).line).not.toHaveBeenCalled();
    expect(autoTable).toHaveBeenCalledWith(
      doc,
      expect.objectContaining({
        margin: HANDOFF_PDF_PAGE_LAYOUT.margin,
      })
    );
  });
});
