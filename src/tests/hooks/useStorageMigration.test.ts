import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useStorageMigration } from '@/hooks/useStorageMigration';
import * as idbService from '@/services/storage/indexedDBService';

// Mock indexedDBService
vi.mock('@/services/storage/indexedDBService', () => ({
    migrateFromLocalStorage: vi.fn(),
    isIndexedDBAvailable: vi.fn(),
}));

describe('useStorageMigration', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should start in migrating state', () => {
        vi.mocked(idbService.isIndexedDBAvailable).mockReturnValue(true);
        vi.mocked(idbService.migrateFromLocalStorage).mockResolvedValue(false);

        const { result } = renderHook(() => useStorageMigration());

        expect(result.current.isMigrating).toBe(true);
        expect(result.current.isComplete).toBe(false);
    });

    it('should complete migration successfully when IndexedDB is available', async () => {
        vi.mocked(idbService.isIndexedDBAvailable).mockReturnValue(true);
        vi.mocked(idbService.migrateFromLocalStorage).mockResolvedValue(true);

        const { result } = renderHook(() => useStorageMigration());

        await waitFor(() => {
            expect(result.current.isComplete).toBe(true);
        });

        expect(result.current.isMigrating).toBe(false);
        expect(result.current.didMigrate).toBe(true);
        expect(result.current.error).toBeNull();
    });

    it('should skip migration when IndexedDB is not available', async () => {
        vi.mocked(idbService.isIndexedDBAvailable).mockReturnValue(false);

        const { result } = renderHook(() => useStorageMigration());

        await waitFor(() => {
            expect(result.current.isComplete).toBe(true);
        });

        expect(result.current.isMigrating).toBe(false);
        expect(result.current.didMigrate).toBe(false);
        expect(idbService.migrateFromLocalStorage).not.toHaveBeenCalled();
    });

    it('should handle migration errors gracefully', async () => {
        vi.mocked(idbService.isIndexedDBAvailable).mockReturnValue(true);
        vi.mocked(idbService.migrateFromLocalStorage).mockRejectedValue(new Error('Migration failed'));

        const { result } = renderHook(() => useStorageMigration());

        await waitFor(() => {
            expect(result.current.isComplete).toBe(true);
        });

        expect(result.current.isMigrating).toBe(false);
        expect(result.current.didMigrate).toBe(false);
        expect(result.current.error).toBe('Migration failed');
    });

    it('should handle non-Error exceptions', async () => {
        vi.mocked(idbService.isIndexedDBAvailable).mockReturnValue(true);
        vi.mocked(idbService.migrateFromLocalStorage).mockRejectedValue('String error');

        const { result } = renderHook(() => useStorageMigration());

        await waitFor(() => {
            expect(result.current.isComplete).toBe(true);
        });

        expect(result.current.error).toBe('Unknown error');
    });
});
