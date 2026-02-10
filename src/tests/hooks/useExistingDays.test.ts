import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useExistingDays } from '@/hooks/useExistingDays';
import * as recordQueryService from '@/services/records/recordQueryService';
import { DailyRecord } from '@/types';

// Mock the record query service
vi.mock('@/services/records/recordQueryService', () => ({
    fetchRecordsForMonth: vi.fn(),
}));

describe('useExistingDays', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should return empty array initially', () => {
        vi.mocked(recordQueryService.fetchRecordsForMonth).mockResolvedValue([]);

        const { result } = renderHook(() => useExistingDays(2024, 11, null));

        expect(result.current).toEqual([]);
    });

    it('should fetch records for the correct month', async () => {
        vi.mocked(recordQueryService.fetchRecordsForMonth).mockResolvedValue([]);

        renderHook(() => useExistingDays(2024, 11, null));

        await waitFor(() => {
            // selectedMonth is 0-indexed, so 11 = December, but we expect 1-indexed in the service
            expect(recordQueryService.fetchRecordsForMonth).toHaveBeenCalledWith(2024, 12);
        });
    });

    it('should return days with patient data', async () => {
        const mockRecords = [
            { date: '2024-12-15', beds: { 'R1': { patientName: 'Patient A' } } },
            { date: '2024-12-20', beds: { 'R1': { patientName: 'Patient B' } } },
            { date: '2024-12-25', beds: { 'R1': { patientName: '' } } },
        ] as unknown as DailyRecord[];

        vi.mocked(recordQueryService.fetchRecordsForMonth).mockResolvedValue(mockRecords);

        const { result } = renderHook(() => useExistingDays(2024, 11, null));

        await waitFor(() => {
            expect(result.current).toContain(15);
            expect(result.current).toContain(20);
            expect(result.current).not.toContain(25);
        });
    });

    it('should handle records with no beds', async () => {
        const mockRecords = [
            { date: '2024-12-15', beds: null },
            { date: '2024-12-20' },
        ] as unknown as DailyRecord[];

        vi.mocked(recordQueryService.fetchRecordsForMonth).mockResolvedValue(mockRecords);

        const { result } = renderHook(() => useExistingDays(2024, 11, null));

        await waitFor(() => {
            expect(result.current).toEqual([]);
        });
    });

    it('should handle fetch errors gracefully', async () => {
        vi.mocked(recordQueryService.fetchRecordsForMonth).mockRejectedValue(new Error('Fetch error'));

        const { result } = renderHook(() => useExistingDays(2024, 11, null));

        await waitFor(() => {
            expect(result.current).toEqual([]);
        });
    });
});
