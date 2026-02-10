import { describe, it, expect, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useBackupFilesQuery } from '@/hooks/useBackupFilesQuery';

// Mock storage services
vi.mock('@/services/backup/pdfStorageService', () => ({
    listYears: vi.fn().mockResolvedValue(['2024', '2023']),
    listMonths: vi.fn().mockResolvedValue([{ name: 'Enero', number: '01' }]),
    listFilesInMonth: vi.fn().mockResolvedValue([]),
}));

vi.mock('@/services/backup/censusStorageService', () => ({
    listCensusYears: vi.fn().mockResolvedValue(['2024']),
    listCensusMonths: vi.fn().mockResolvedValue([]),
    listCensusFilesInMonth: vi.fn().mockResolvedValue([]),
}));

vi.mock('@/features/cudyr/services/cudyrStorageService', () => ({
    listCudyrYears: vi.fn().mockResolvedValue(['2024']),
    listCudyrMonths: vi.fn().mockResolvedValue([]),
    listCudyrFilesInMonth: vi.fn().mockResolvedValue([]),
}));

describe('useBackupFilesQuery', () => {
    const createTestQueryClient = () => new QueryClient({
        defaultOptions: {
            queries: { retry: false }
        }
    });

    const wrapper = ({ children }: { children: React.ReactNode }) => (
        <QueryClientProvider client={createTestQueryClient()}>
            {children}
        </QueryClientProvider>
    );

    it('should fetch years when path is empty', async () => {
        const { result } = renderHook(
            () => useBackupFilesQuery('handoff', []),
            { wrapper }
        );

        await waitFor(() => {
            expect(result.current.isSuccess).toBe(true);
        });

        expect(result.current.data?.length).toBe(2);
        expect(result.current.data?.[0].type).toBe('folder');
    });

    it('should fetch months when path has year', async () => {
        const { result } = renderHook(
            () => useBackupFilesQuery('handoff', ['2024']),
            { wrapper }
        );

        await waitFor(() => {
            expect(result.current.isSuccess).toBe(true);
        });

        expect(result.current.data?.length).toBe(1);
        expect((result.current.data?.[0].data as any).name).toBe('Enero');
    });

    it('should fetch files when path has year and month', async () => {
        const { result } = renderHook(
            () => useBackupFilesQuery('handoff', ['2024', 'Enero']),
            { wrapper }
        );

        await waitFor(() => {
            expect(result.current.isSuccess).toBe(true);
        });

        expect(result.current.data).toEqual([]);
    });

    it('should use census service for census type', async () => {
        const { result } = renderHook(
            () => useBackupFilesQuery('census', []),
            { wrapper }
        );

        await waitFor(() => {
            expect(result.current.isSuccess).toBe(true);
        });

        expect(result.current.data?.length).toBe(1);
    });
});
