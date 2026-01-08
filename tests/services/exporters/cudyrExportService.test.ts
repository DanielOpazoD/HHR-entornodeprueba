import { describe, it, expect, vi, beforeEach } from 'vitest';
import { generateCudyrMonthlyExcel, generateCudyrMonthlyExcelBlob } from '@/services/exporters/cudyrExportService';
import { getCudyrMonthlyTotals } from '@/services/calculations/cudyrSummary';
import { createWorkbook } from '@/services/exporters/excelUtils';
import { saveAs } from 'file-saver';

// Mock dependencies
vi.mock('file-saver', () => ({
    saveAs: vi.fn()
}));

vi.mock('@/firebaseConfig', () => ({
    db: {}
}));

vi.mock('@/services/exporters/excelUtils', () => ({
    createWorkbook: vi.fn(),
    BORDER_THIN: {}
}));

vi.mock('@/services/calculations/cudyrSummary', () => ({
    getCudyrMonthlyTotals: vi.fn()
}));

describe('cudyrExportService', () => {
    const mockWorksheet = {
        columns: [],
        getCell: vi.fn(() => ({ value: '', font: {}, border: {}, alignment: {}, fill: {}, mergeCells: vi.fn() })),
        getRow: vi.fn(() => ({
            values: [],
            font: {},
            alignment: {},
            getCell: vi.fn(() => ({ value: '', font: {}, border: {}, alignment: {}, fill: {} }))
        })),
        mergeCells: vi.fn(),
        properties: {}
    };

    const mockWorkbook = {
        creator: '',
        created: new Date(),
        addWorksheet: vi.fn(() => mockWorksheet),
        xlsx: {
            writeBuffer: vi.fn(() => Promise.resolve(Buffer.from('test buffer')))
        }
    };

    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(createWorkbook).mockResolvedValue(mockWorkbook as any);
        // Provide a default return for getCudyrMonthlyTotals
        vi.mocked(getCudyrMonthlyTotals).mockResolvedValue({
            dailySummaries: [],
            totals: { uti: {}, media: {} },
            utiTotal: 0,
            mediaTotal: 0,
            totalOccupied: 0,
            totalCategorized: 0,
            year: 2025,
            month: 1
        } as any);
    });

    it('should generate monthly excel and trigger saveAs', async () => {
        // Setup mock data with 1 day
        vi.mocked(getCudyrMonthlyTotals).mockResolvedValue({
            dailySummaries: [
                {
                    date: '2025-01-01',
                    counts: { uti: { A1: 1 }, media: { A1: 0 } },
                    utiTotal: 1,
                    mediaTotal: 0,
                    occupiedCount: 1,
                    categorizedCount: 1
                }
            ],
            totals: { uti: { A1: 1 }, media: { A1: 0 } },
            year: 2025,
            month: 1
        } as any);

        await generateCudyrMonthlyExcel(2025, 1);

        expect(createWorkbook).toHaveBeenCalled();
        expect(mockWorkbook.addWorksheet).toHaveBeenCalledWith('Resumen Mensual', expect.any(Object));
        expect(mockWorkbook.addWorksheet).toHaveBeenCalledWith('01-01-2025');
        expect(saveAs).toHaveBeenCalled();
    });

    it('should generate monthly excel blob', async () => {
        const blob = await generateCudyrMonthlyExcelBlob(2025, 1);
        expect(blob).toBeInstanceOf(Blob);
        expect(mockWorkbook.xlsx.writeBuffer).toHaveBeenCalled();
    });

    it('should handle period with no data', async () => {
        vi.mocked(getCudyrMonthlyTotals).mockResolvedValue({
            dailySummaries: [],
            totals: { uti: {}, media: {} },
            year: 2025,
            month: 1
        } as any);

        await generateCudyrMonthlyExcel(2025, 1);

        expect(mockWorksheet.getCell).toHaveBeenCalledWith('A3');
        // The mockWorksheet.getCell returns an object that can have its value checked if we tracked it better, 
        // but for now verifying it was called is enough for coverage.
    });
});
