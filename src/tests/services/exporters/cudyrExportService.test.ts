import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  generateCudyrMonthlyExcel,
  generateCudyrMonthlyExcelBlob,
} from '@/services/cudyr/cudyrExportService';
import { getCudyrMonthlyTotals } from '@/services/cudyr/cudyrSummary';
import type { CudyrMonthlySummary } from '@/services/cudyr/cudyrSummary';
import { createWorkbook } from '@/services/exporters/excelUtils';
import { saveAs } from 'file-saver';
import { getRecordFromFirestore } from '@/services/storage/firestore';

// Mock dependencies
vi.mock('file-saver', () => ({
  saveAs: vi.fn(),
}));

vi.mock('@/firebaseConfig', () => ({
  db: {},
}));

vi.mock('@/services/exporters/excelUtils', () => ({
  createWorkbook: vi.fn(),
  BORDER_THIN: {},
}));

vi.mock('@/services/cudyr/cudyrSummary', () => ({
  getCudyrMonthlyTotals: vi.fn(),
}));

vi.mock('@/services/storage/firestore', () => ({
  getRecordFromFirestore: vi.fn(),
}));

describe('cudyrExportService', () => {
  const mockWorksheet = {
    columns: [],
    getCell: vi.fn(() => ({
      value: '',
      font: {},
      border: {},
      alignment: {},
      fill: {},
      mergeCells: vi.fn(),
    })),
    getRow: vi.fn(() => ({
      values: [],
      font: {},
      alignment: {},
      getCell: vi.fn(() => ({ value: '', font: {}, border: {}, alignment: {}, fill: {} })),
    })),
    mergeCells: vi.fn(),
    properties: {},
  };

  const mockWorkbook = {
    creator: '',
    created: new Date('2026-02-20T00:00:00.000Z'),
    addWorksheet: vi.fn(() => mockWorksheet),
    xlsx: {
      writeBuffer: vi.fn(() => {
        // Create a buffer that passes validateExcelExport:
        // 1. Starts with ZIP magic bytes (0x50 0x4B)
        // 2. Size >= 5000 bytes
        const buf = Buffer.alloc(6000);
        buf[0] = 0x50;
        buf[1] = 0x4b;
        return Promise.resolve(buf);
      }),
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    window.__HHR_E2E_OVERRIDE__ = undefined;
    vi.mocked(createWorkbook).mockResolvedValue(
      mockWorkbook as unknown as Awaited<ReturnType<typeof createWorkbook>>
    );
    // Provide a default return for getCudyrMonthlyTotals
    const emptySummary: CudyrMonthlySummary = {
      dailySummaries: [],
      totals: { uti: {}, media: {} },
      utiTotal: 0,
      mediaTotal: 0,
      totalOccupied: 0,
      totalCategorized: 0,
      year: 2025,
      month: 1,
    } as unknown as CudyrMonthlySummary;
    vi.mocked(getCudyrMonthlyTotals).mockResolvedValue(emptySummary);
    vi.mocked(getRecordFromFirestore).mockResolvedValue(null);
  });

  it('should generate monthly excel and trigger saveAs', async () => {
    // Setup mock data with 1 day
    const oneDaySummary: CudyrMonthlySummary = {
      dailySummaries: [
        {
          date: '2025-01-01',
          counts: { uti: { A1: 1 }, media: { A1: 0 } },
          utiTotal: 1,
          mediaTotal: 0,
          occupiedCount: 1,
          categorizedCount: 1,
        },
      ],
      totals: { uti: { A1: 1 }, media: { A1: 0 } },
      year: 2025,
      month: 1,
    } as unknown as CudyrMonthlySummary;
    vi.mocked(getCudyrMonthlyTotals).mockResolvedValue(oneDaySummary);

    await generateCudyrMonthlyExcel(2025, 1);

    expect(createWorkbook).toHaveBeenCalled();
    expect(mockWorkbook.addWorksheet).toHaveBeenCalledWith(
      'Resumen CUDYR Mensual',
      expect.any(Object)
    );
    expect(mockWorkbook.addWorksheet).toHaveBeenCalledWith('01-01-2025');
    expect(saveAs).toHaveBeenCalled();
    expect(vi.mocked(saveAs).mock.calls[0]?.[1]).toContain('CUDYR_Mensual_Enero_2025');
  });

  it('should generate monthly excel blob', async () => {
    const blob = await generateCudyrMonthlyExcelBlob(2025, 1);
    expect(blob).toBeInstanceOf(Blob);
    expect(mockWorkbook.xlsx.writeBuffer).toHaveBeenCalled();
  });

  it('rejects an invalid CUDYR blob before it can be uploaded as backup', async () => {
    mockWorkbook.xlsx.writeBuffer.mockResolvedValueOnce(Buffer.from([1, 2, 3]));

    await expect(generateCudyrMonthlyExcelBlob(2025, 1)).rejects.toThrow(
      /archivo Excel CUDYR invalido/i
    );
  });

  it('hydrates the current/end date from Firestore before building the summary', async () => {
    const localRecord = {
      date: '2025-01-05',
      beds: {},
      activeExtraBeds: [],
      discharges: [],
      transfers: [],
      cma: [],
      lastUpdated: '2025-01-05T08:00:00.000Z',
    } as const;
    const remoteRecord = {
      ...localRecord,
      lastUpdated: '2025-01-05T10:00:00.000Z',
    };

    vi.mocked(getRecordFromFirestore).mockResolvedValue(remoteRecord as never);

    await generateCudyrMonthlyExcelBlob(2025, 1, '2025-01-05', localRecord as never);

    expect(getRecordFromFirestore).toHaveBeenCalledWith('2025-01-05');
    expect(getCudyrMonthlyTotals).toHaveBeenCalledWith(
      2025,
      1,
      '2025-01-05',
      expect.any(Function),
      expect.objectContaining({ lastUpdated: '2025-01-05T10:00:00.000Z' })
    );
  });

  it('uses E2E override records for monthly fetches without waiting on Firestore', async () => {
    const overrideRecord = {
      date: '2025-01-01',
      beds: {},
      activeExtraBeds: [],
      discharges: [],
      transfers: [],
      cma: [],
      lastUpdated: '2025-01-01T10:00:00.000Z',
    };
    window.__HHR_E2E_OVERRIDE__ = {
      '2025-01-01': overrideRecord as never,
    };

    await generateCudyrMonthlyExcelBlob(2025, 1, '2025-01-02');

    const fetchRecord = vi.mocked(getCudyrMonthlyTotals).mock.calls[0]?.[3];
    await expect(fetchRecord?.('2025-01-01')).resolves.toMatchObject({
      lastUpdated: '2025-01-01T10:00:00.000Z',
    });
    await expect(fetchRecord?.('2025-01-02')).resolves.toBeNull();
    expect(getRecordFromFirestore).not.toHaveBeenCalled();
  });

  it('should handle period with no data', async () => {
    const noDataSummary: CudyrMonthlySummary = {
      dailySummaries: [],
      totals: { uti: {}, media: {} },
      year: 2025,
      month: 1,
    } as unknown as CudyrMonthlySummary;
    vi.mocked(getCudyrMonthlyTotals).mockResolvedValue(noDataSummary);

    await generateCudyrMonthlyExcel(2025, 1);

    expect(mockWorksheet.getCell).toHaveBeenCalledWith('A3');
    // The mockWorksheet.getCell returns an object that can have its value checked if we tracked it better,
    // but for now verifying it was called is enough for coverage.
  });
});
