import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useDailyRecordSyncQuery } from '@/hooks/useDailyRecordSyncQuery';
import * as DailyRecordRepository from '@/services/repositories/DailyRecordRepository';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

// Mock Repository
vi.mock('@/services/repositories/DailyRecordRepository', () => {
    const mockImpl = {
        getForDate: vi.fn(),
        save: vi.fn().mockResolvedValue(undefined),
        subscribe: vi.fn(() => vi.fn()),
        updatePartial: vi.fn().mockResolvedValue(undefined),
    };
    return {
        ...mockImpl,
        DailyRecordRepository: mockImpl
    };
});

import { UIProvider } from '@/context/UIContext';

const createWrapper = () => {
    const queryClient = new QueryClient({
        defaultOptions: {
            queries: {
                retry: false,
            },
        },
    });
    return ({ children }: { children: React.ReactNode }) => (
        <QueryClientProvider client={queryClient}>
            <UIProvider>
                {children}
            </UIProvider>
        </QueryClientProvider>
    );
};

describe('useDailyRecordSyncQuery', () => {
    const mockDate = '2025-12-27';
    const mockRecord = {
        id: 'rec-1',
        date: mockDate,
        beds: {},
        lastUpdated: new Date().toISOString(),
        discharges: [],
        transfers: [],
        cma: [],
        nurses: [],
        activeExtraBeds: []
    };

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should fetch the record on mount', async () => {
        (DailyRecordRepository.getForDate as any).mockResolvedValue(mockRecord);

        const { result } = renderHook(() => useDailyRecordSyncQuery(mockDate), {
            wrapper: createWrapper()
        });

        await waitFor(() => {
            expect(result.current.record).toEqual(mockRecord);
        });

        expect(DailyRecordRepository.getForDate).toHaveBeenCalledWith(mockDate);
    });

    it('should handle updates via saveAndUpdate', async () => {
        (DailyRecordRepository.getForDate as any).mockResolvedValue(mockRecord);

        const { result } = renderHook(() => useDailyRecordSyncQuery(mockDate), {
            wrapper: createWrapper()
        });

        await waitFor(() => expect(result.current.record).not.toBeNull());

        const updatedRecord = { ...mockRecord, lastUpdated: 'new-date' };
        await result.current.saveAndUpdate(updatedRecord);

        expect(DailyRecordRepository.save).toHaveBeenCalledWith(updatedRecord);
    });
});
