import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useExportManager } from '@/hooks/useExportManager';
import { DailyRecord } from '@/types';

// Mock context
vi.mock('@/context/UIContext', () => ({
    useNotification: () => ({
        success: vi.fn(),
        error: vi.fn(),
        warning: vi.fn(),
    }),
    useConfirmDialog: () => ({
        confirm: vi.fn().mockResolvedValue(true),
    }),
}));

// Mock services
vi.mock('@/services/backup/censusStorageService', () => ({
    checkCensusExists: vi.fn().mockResolvedValue(false),
    uploadCensus: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/services', () => ({
    getMonthRecordsFromFirestore: vi.fn().mockResolvedValue([]),
}));

vi.mock('@/services/exporters/censusMasterWorkbook', () => ({
    buildCensusMasterWorkbook: vi.fn().mockResolvedValue({
        xlsx: { writeBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(0)) }
    }),
}));

vi.mock('@/services/backup/pdfStorageService', () => ({
    pdfExists: vi.fn().mockResolvedValue(false),
}));

describe('useExportManager', () => {
    const mockRecord: DailyRecord = {
        date: '2024-12-28',
        beds: {},
        discharges: [],
        transfers: [],
        nursesDayShift: ['Nurse A'],
        nursesNightShift: ['Nurse B'],
        handoffNightReceives: ['Nurse C'],
    } as unknown as DailyRecord;

    const defaultProps = {
        currentDateString: '2024-12-28',
        selectedYear: 2024,
        selectedMonth: 11,
        selectedDay: 28,
        record: mockRecord,
        currentModule: 'CENSUS',
        selectedShift: 'day' as const,
    };

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should return all export functions', () => {
        const { result } = renderHook(() => useExportManager(defaultProps));

        expect(typeof result.current.handleExportPDF).toBe('function');
        expect(typeof result.current.handleBackupExcel).toBe('function');
        expect(typeof result.current.handleBackupHandoff).toBe('function');
        expect(result.current.isArchived).toBe(false);
        expect(result.current.isBackingUp).toBe(false);
    });

    it('should check archive status on mount for CENSUS module', async () => {
        const { result } = renderHook(() => useExportManager(defaultProps));

        await waitFor(() => {
            expect(result.current.isArchived).toBeDefined();
        });
    });

    it('should check archive status for NURSING_HANDOFF module', async () => {
        const props = {
            ...defaultProps,
            currentModule: 'NURSING_HANDOFF'
        };

        const { result } = renderHook(() => useExportManager(props));

        await waitFor(() => {
            expect(result.current.isArchived).toBeDefined();
        });
    });

    it('should handle null record', () => {
        const props = {
            ...defaultProps,
            record: null
        };

        const { result } = renderHook(() => useExportManager(props));

        expect(result.current.handleExportPDF).toBeDefined();
    });
});
