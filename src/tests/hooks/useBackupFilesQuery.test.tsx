import { describe, it, expect, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useBackupFilesQuery } from '@/hooks/useBackupFilesQuery';
import { createQueryClientTestWrapper } from '@/tests/utils/queryClientTestUtils';

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
    const createWrapper = () => createQueryClientTestWrapper().wrapper;

    it('should fetch years when path is empty', async () => {
        const { result } = renderHook(
            () => useBackupFilesQuery('handoff', []),
            { wrapper: createWrapper() }
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
            { wrapper: createWrapper() }
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
            { wrapper: createWrapper() }
        );

        await waitFor(() => {
            expect(result.current.isSuccess).toBe(true);
        });

        expect(result.current.data).toEqual([]);
    });

    it('should use census service for census type', async () => {
        const { result } = renderHook(
            () => useBackupFilesQuery('census', []),
            { wrapper: createWrapper() }
        );

        await waitFor(() => {
            expect(result.current.isSuccess).toBe(true);
        });

        expect(result.current.data?.length).toBe(1);
    });
});
