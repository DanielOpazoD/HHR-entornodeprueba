import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useFileOperations } from '@/hooks/useFileOperations';
import { DailyRecord } from '@/types';
import * as ExportService from '@/services/exporters/exportService';

// Mock context
vi.mock('@/context/UIContext', () => ({
    useNotification: () => ({
        success: vi.fn(),
        error: vi.fn(),
    }),
}));

// Mock export service
vi.mock('@/services/exporters/exportService', () => ({
    exportDataJSON: vi.fn(),
    exportDataCSV: vi.fn(),
    importDataJSON: vi.fn().mockResolvedValue(true),
}));

describe('useFileOperations', () => {
    const mockRecord: DailyRecord = { date: '2024-12-28', beds: {} } as DailyRecord;
    const mockOnRefresh = vi.fn();

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should return all file operation functions', () => {
        const { result } = renderHook(() =>
            useFileOperations(mockRecord, mockOnRefresh)
        );

        expect(typeof result.current.handleExportJSON).toBe('function');
        expect(typeof result.current.handleExportCSV).toBe('function');
        expect(typeof result.current.handleImportJSON).toBe('function');
        expect(typeof result.current.handleImportFile).toBe('function');
    });

    it('should export JSON', () => {
        const { result } = renderHook(() =>
            useFileOperations(mockRecord, mockOnRefresh)
        );

        act(() => {
            result.current.handleExportJSON();
        });

        expect(ExportService.exportDataJSON).toHaveBeenCalled();
    });

    it('should export CSV', () => {
        const { result } = renderHook(() =>
            useFileOperations(mockRecord, mockOnRefresh)
        );

        act(() => {
            result.current.handleExportCSV();
        });

        expect(ExportService.exportDataCSV).toHaveBeenCalledWith(mockRecord);
    });

    it('should import JSON file', async () => {
        const { result } = renderHook(() =>
            useFileOperations(mockRecord, mockOnRefresh)
        );

        const file = new File(['{}'], 'test.json', { type: 'application/json' });

        await act(async () => {
            await result.current.handleImportFile(file);
        });

        expect(ExportService.importDataJSON).toHaveBeenCalledWith(file);
        expect(mockOnRefresh).toHaveBeenCalled();
    });

    it('should reject non-JSON files', async () => {
        const { result } = renderHook(() =>
            useFileOperations(mockRecord, mockOnRefresh)
        );

        const file = new File(['data'], 'test.txt', { type: 'text/plain' });

        await act(async () => {
            await result.current.handleImportFile(file);
        });

        expect(ExportService.importDataJSON).not.toHaveBeenCalled();
    });
});
