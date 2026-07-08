import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { buildCudyrWorkbook } from '@/services/cudyr/cudyrWorkbookBuilder';
import type { CudyrMonthlySummary } from '@/services/cudyr/cudyrSummary';

const emptyCategoryCounts = () => ({
  A1: 0,
  A2: 0,
  A3: 0,
  B1: 0,
  B2: 0,
  B3: 0,
  C1: 0,
  C2: 0,
  C3: 0,
  D1: 0,
  D2: 0,
  D3: 0,
});

describe('cudyrWorkbookBuilder', () => {
  it('opens with the monthly summary before daily worksheets and keeps formulas linked', async () => {
    const monthlySummary: CudyrMonthlySummary = {
      year: 2025,
      month: 1,
      totals: {
        uti: { ...emptyCategoryCounts(), A1: 2 },
        media: { ...emptyCategoryCounts(), B2: 1 },
      },
      utiTotal: 2,
      mediaTotal: 1,
      totalOccupied: 4,
      totalCategorized: 3,
      dailySummaries: [
        {
          date: '2025-01-01',
          counts: {
            uti: { ...emptyCategoryCounts(), A1: 2 },
            media: { ...emptyCategoryCounts(), B2: 1 },
          },
          utiTotal: 2,
          mediaTotal: 1,
          occupiedCount: 4,
          categorizedCount: 3,
        },
      ],
    };

    const { workbook, fileName } = await buildCudyrWorkbook({
      year: 2025,
      month: 1,
      endDate: '2025-01-01',
      monthlySummary,
    });

    expect(fileName).toBe(
      'CUDYR_Mensual_Enero_2025_hasta_el_último_registro_disponible_del_01-01-2025.xlsx'
    );
    expect(workbook.worksheets.map(sheet => sheet.name)).toEqual([
      'Resumen CUDYR Mensual',
      '01-01-2025',
    ]);
    expect(workbook.worksheets[0]?.getCell('A1').value).toContain('Resumen CUDYR mensual');
    expect(workbook.getWorksheet('Resumen CUDYR Mensual')?.getCell('B4').value).toMatchObject({
      formula: "'01-01-2025'!B4",
      result: 2,
    });
    expect(workbook.views[0]).toEqual(
      expect.objectContaining({
        activeTab: 0,
        firstSheet: 0,
        visibility: 'visible',
      })
    );
    expect(workbook.getWorksheet('01-01-2025')?.views[0]).toMatchObject({
      state: 'frozen',
      xSplit: 2,
      ySplit: 3,
    });
  });

  it('serializes a reopenable CUDYR workbook with stable formulas and sheet order', async () => {
    const monthlySummary: CudyrMonthlySummary = {
      year: 2025,
      month: 1,
      totals: {
        uti: { ...emptyCategoryCounts(), A1: 2 },
        media: { ...emptyCategoryCounts(), B2: 1 },
      },
      utiTotal: 2,
      mediaTotal: 1,
      totalOccupied: 4,
      totalCategorized: 3,
      dailySummaries: [
        {
          date: '2025-01-01',
          counts: {
            uti: { ...emptyCategoryCounts(), A1: 2 },
            media: { ...emptyCategoryCounts(), B2: 1 },
          },
          utiTotal: 2,
          mediaTotal: 1,
          occupiedCount: 4,
          categorizedCount: 3,
        },
      ],
    };

    const { workbook } = await buildCudyrWorkbook({
      year: 2025,
      month: 1,
      endDate: '2025-01-01',
      monthlySummary,
    });
    const buffer = await workbook.xlsx.writeBuffer();
    const reopened = new ExcelJS.Workbook();
    await reopened.xlsx.load(buffer);

    expect(reopened.worksheets.map(sheet => sheet.name)).toEqual([
      'Resumen CUDYR Mensual',
      '01-01-2025',
    ]);
    expect(reopened.getWorksheet('Resumen CUDYR Mensual')?.getCell('B4').value).toMatchObject({
      formula: "'01-01-2025'!B4",
      result: 2,
    });
  });

  it('keeps the monthly summary navigable and explicit when the selected period has no CUDYR data', async () => {
    const monthlySummary: CudyrMonthlySummary = {
      year: 2025,
      month: 1,
      totals: {
        uti: emptyCategoryCounts(),
        media: emptyCategoryCounts(),
      },
      utiTotal: 0,
      mediaTotal: 0,
      totalOccupied: 0,
      totalCategorized: 0,
      dailySummaries: [],
    };

    const { workbook } = await buildCudyrWorkbook({
      year: 2025,
      month: 1,
      endDate: '2025-01-31',
      monthlySummary,
    });
    const summarySheet = workbook.getWorksheet('Resumen CUDYR Mensual');

    expect(workbook.worksheets.map(sheet => sheet.name)).toEqual(['Resumen CUDYR Mensual']);
    expect(summarySheet?.views[0]).toMatchObject({ state: 'frozen', ySplit: 2 });
    expect(summarySheet?.getCell('A1').value).toContain('Resumen CUDYR mensual');
    expect(summarySheet?.getCell('A3').value).toBe('No hay datos para el periodo seleccionado.');

    const buffer = await workbook.xlsx.writeBuffer();
    const reopened = new ExcelJS.Workbook();
    await reopened.xlsx.load(buffer);

    expect(reopened.worksheets.map(sheet => sheet.name)).toEqual(['Resumen CUDYR Mensual']);
    expect(reopened.getWorksheet('Resumen CUDYR Mensual')?.getCell('A3').value).toBe(
      'No hay datos para el periodo seleccionado.'
    );
  });
});
