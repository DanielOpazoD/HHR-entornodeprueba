import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ExcelParsingService } from '@/services/ExcelParsingService';
import * as excelUtils from '@/services/exporters/excelUtils';
import type { Workbook, Worksheet, Cell, Row } from 'exceljs';

// Mock excelUtils
vi.mock('@/services/exporters/excelUtils', () => ({
    createWorkbook: vi.fn(),
}));

describe('ExcelParsingService', () => {
    beforeEach(() => {
        vi.clearAllMocks();

        // Polyfill Blob.arrayBuffer for JSDOM if missing
        if (!Blob.prototype.arrayBuffer) {
            Blob.prototype.arrayBuffer = function () {
                return new Promise((resolve) => {
                    const reader = new FileReader();
                    reader.onload = () => {
                        resolve(reader.result as ArrayBuffer);
                    };
                    reader.readAsArrayBuffer(this);
                });
            };
        }
    });

    const createMockSheet = (name: string, rows: Partial<Cell>[][]) => {
        const mockSheet = {
            name,
            rowCount: rows.length,
            columnCount: rows[0]?.length || 0,
            getRow: vi.fn((r: number) => ({
                getCell: vi.fn((c: number) => rows[r - 1][c - 1])
            } as unknown as Row)),
            _merges: {} as Record<string, any>
        } as unknown as Worksheet;
        return mockSheet;
    };

    const createMockWorkbook = (sheets: Worksheet[]) => {
        return {
            xlsx: { load: vi.fn().mockResolvedValue(undefined) },
            eachSheet: vi.fn((cb: (sheet: Worksheet) => void) => sheets.forEach(s => cb(s)))
        } as unknown as Workbook;
    };

    describe('parseBlob', () => {
        it('parses basic cells correctly', async () => {
            const mockSheet = createMockSheet('Sheet1', [
                [{ value: 'A1', isMerged: false, address: 'A1' } as Partial<Cell>]
            ]);
            const mockWorkbook = createMockWorkbook([mockSheet]);

            vi.mocked(excelUtils.createWorkbook).mockResolvedValue(mockWorkbook);

            const result = await ExcelParsingService.parseBlob(new Blob());

            expect(result.sheetNames).toEqual(['Sheet1']);
            expect(result.workbookData['Sheet1'][0][0].value).toBe('A1');
        });

        it('handles merged cells correctly', async () => {
            const master = { address: 'A1', value: 'Master' };
            const mockSheet = createMockSheet('Sheet1', [
                [
                    { value: 'Master', isMerged: true, address: 'A1', master } as Partial<Cell>,
                    { value: null, isMerged: true, address: 'B1', master } as Partial<Cell>
                ]
            ]);
            (mockSheet as any)._merges = { 'A1': { top: 1, left: 1, bottom: 1, right: 2 } };
            const mockWorkbook = createMockWorkbook([mockSheet]);

            vi.mocked(excelUtils.createWorkbook).mockResolvedValue(mockWorkbook);

            const result = await ExcelParsingService.parseBlob(new Blob());

            const grid = result.workbookData['Sheet1'];
            expect(grid[0][0].colSpan).toBe(2);
            expect(grid[0][1].hidden).toBe(true);
        });

        it('extracts rich text and formula results', async () => {
            const mockSheet = createMockSheet('Sheet1', [
                [
                    { value: { richText: [{ text: 'Hello' }] }, isMerged: false, address: 'A1' } as Partial<Cell>,
                    { value: { result: 123 }, isMerged: false, address: 'B1' } as Partial<Cell>
                ]
            ]);
            const mockWorkbook = createMockWorkbook([mockSheet]);

            vi.mocked(excelUtils.createWorkbook).mockResolvedValue(mockWorkbook);

            const result = await ExcelParsingService.parseBlob(new Blob());

            expect(result.workbookData['Sheet1'][0][0].value).toBe('Hello');
            expect(result.workbookData['Sheet1'][0][1].value).toBe(123);
        });
    });
});
