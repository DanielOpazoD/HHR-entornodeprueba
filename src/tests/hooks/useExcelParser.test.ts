import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useExcelParser } from '@/hooks/useExcelParser';
import { ExcelParsingService } from '@/services/ExcelParsingService';

// Mock ExcelParsingService
vi.mock('@/services/ExcelParsingService', () => ({
    ExcelParsingService: {
        parseBlob: vi.fn()
    }
}));

describe('useExcelParser', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.stubGlobal('fetch', vi.fn());
    });

    it('initializes with default values', () => {
        const { result } = renderHook(() => useExcelParser());
        expect(result.current.workbookData).toEqual({});
        expect(result.current.isParsing).toBe(false);
        expect(result.current.parseError).toBeNull();
    });

    describe('parseFromBlob', () => {
        it('calls service and updates state on success', async () => {
            const mockData = {
                sheetNames: ['Sheet1'],
                workbookData: { 'Sheet1': [[{ value: 'Test', colSpan: 1, rowSpan: 1, hidden: false }]] }
            };

            vi.mocked(ExcelParsingService.parseBlob).mockResolvedValue(mockData);

            const { result } = renderHook(() => useExcelParser());
            await act(async () => {
                await result.current.parseFromBlob(new Blob());
            });

            expect(ExcelParsingService.parseBlob).toHaveBeenCalled();
            expect(result.current.sheetNames).toEqual(['Sheet1']);
            expect(result.current.workbookData).toEqual(mockData.workbookData);
            expect(result.current.activeSheet).toBe('Sheet1');
            expect(result.current.isParsing).toBe(false);
            expect(result.current.parseError).toBeNull();
        });

        it('handles service errors', async () => {
            vi.mocked(ExcelParsingService.parseBlob).mockRejectedValue(new Error('Parse error'));

            const { result } = renderHook(() => useExcelParser());
            await act(async () => {
                await result.current.parseFromBlob(new Blob());
            });

            expect(result.current.parseError).toContain('No se pudo cargar');
            expect(result.current.isParsing).toBe(false);
        });
    });

    describe('parseFromUrl', () => {
        it('fetches and calls parseBlob', async () => {
            const mockBlob = new Blob();
            vi.mocked(fetch).mockResolvedValue({
                ok: true,
                blob: () => Promise.resolve(mockBlob)
            } as any);

            vi.mocked(ExcelParsingService.parseBlob).mockResolvedValue({ sheetNames: [], workbookData: {} });

            const { result } = renderHook(() => useExcelParser());
            await act(async () => {
                await result.current.parseFromUrl('http://test.com');
            });

            expect(fetch).toHaveBeenCalledWith('http://test.com', expect.anything());
            expect(ExcelParsingService.parseBlob).toHaveBeenCalledWith(mockBlob);
        });
    });
});
