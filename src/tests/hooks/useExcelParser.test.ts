import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useExcelParser } from '@/hooks/useExcelParser';
import * as excelUtils from '@/services/exporters/excelUtils';

// Mock excelUtils
vi.mock('@/services/exporters/excelUtils', () => ({
    createWorkbook: vi.fn(),
}));

describe('useExcelParser', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.stubGlobal('fetch', vi.fn());

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

    const createMockSheet = (name: string, rows: any[][]) => {
        const mockSheet: any = {
            name,
            rowCount: rows.length,
            columnCount: rows[0]?.length || 0,
            getRow: vi.fn((r) => ({
                getCell: vi.fn((c) => rows[r - 1][c - 1])
            })),
            _merges: {}
        };
        return mockSheet;
    };

    const createMockWorkbook = (sheets: any[]) => {
        return {
            xlsx: { load: vi.fn().mockResolvedValue(undefined) },
            eachSheet: vi.fn((cb) => sheets.forEach(s => cb(s)))
        };
    };

    it('initializes with default values', () => {
        const { result } = renderHook(() => useExcelParser());
        expect(result.current.workbookData).toEqual({});
        expect(result.current.isParsing).toBe(false);
        expect(result.current.parseError).toBeNull();
    });

    describe('parseFromBlob', () => {
        it('parses basic cells correctly', async () => {
            const mockSheet = createMockSheet('Sheet1', [
                [{ value: 'A1', isMerged: false, address: 'A1' }]
            ]);
            const mockWorkbook = createMockWorkbook([mockSheet]);

            vi.mocked(excelUtils.createWorkbook).mockResolvedValue(mockWorkbook as any);

            const { result } = renderHook(() => useExcelParser());
            await act(async () => {
                await result.current.parseFromBlob(new Blob());
            });

            expect(result.current.sheetNames).toEqual(['Sheet1']);
            expect(result.current.workbookData['Sheet1'][0][0].value).toBe('A1');
        });

        it('handles merged cells correctly', async () => {
            const master = { address: 'A1', value: 'Master' };
            const mockSheet = createMockSheet('Sheet1', [
                [
                    { value: 'Master', isMerged: true, address: 'A1', master },
                    { value: null, isMerged: true, address: 'B1', master }
                ]
            ]);
            mockSheet._merges = { 'A1': { top: 1, left: 1, bottom: 1, right: 2 } };
            const mockWorkbook = createMockWorkbook([mockSheet]);

            vi.mocked(excelUtils.createWorkbook).mockResolvedValue(mockWorkbook as any);

            const { result } = renderHook(() => useExcelParser());
            await act(async () => {
                await result.current.parseFromBlob(new Blob());
            });

            const grid = result.current.workbookData['Sheet1'];
            expect(grid[0][0].colSpan).toBe(2);
            expect(grid[0][1].hidden).toBe(true);
        });

        it('extracts rich text and formula results', async () => {
            const mockSheet = createMockSheet('Sheet1', [
                [
                    { value: { richText: [{ text: 'Hello' }] }, isMerged: false, address: 'A1' },
                    { value: { result: 123 }, isMerged: false, address: 'B1' }
                ]
            ]);
            const mockWorkbook = createMockWorkbook([mockSheet]);

            vi.mocked(excelUtils.createWorkbook).mockResolvedValue(mockWorkbook as any);

            const { result } = renderHook(() => useExcelParser());
            await act(async () => {
                await result.current.parseFromBlob(new Blob());
            });

            expect(result.current.workbookData['Sheet1'][0][0].value).toBe('Hello');
            expect(result.current.workbookData['Sheet1'][0][1].value).toBe(123);
        });
    });

    describe('parseFromUrl', () => {
        it('fetches and parses successfully', async () => {
            vi.mocked(fetch).mockResolvedValue({
                ok: true,
                blob: () => Promise.resolve(new Blob())
            } as any);

            vi.mocked(excelUtils.createWorkbook).mockResolvedValue(createMockWorkbook([]) as any);

            const { result } = renderHook(() => useExcelParser());
            await act(async () => {
                await result.current.parseFromUrl('http://test.com');
            });

            expect(fetch).toHaveBeenCalled();
        });
    });
});
