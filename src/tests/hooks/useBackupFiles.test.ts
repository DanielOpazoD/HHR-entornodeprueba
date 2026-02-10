import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useBackupFiles } from '@/hooks/useBackupFiles';

// Mock backup service
vi.mock('@/services/backup/backupService', () => ({
    listBackupFiles: vi.fn().mockResolvedValue([]),
    getBackupFile: vi.fn().mockResolvedValue({ id: 'test-1', content: {} }),
    deleteBackupFile: vi.fn().mockResolvedValue(undefined),
    saveNursingHandoffBackup: vi.fn().mockResolvedValue('new-id'),
    checkBackupExists: vi.fn().mockResolvedValue(false),
}));

import * as backupService from '@/services/backup/backupService';

describe('useBackupFiles', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should return all backup file functions', async () => {
        const { result } = renderHook(() => useBackupFiles());

        await waitFor(() => {
            expect(result.current.isLoading).toBe(false);
        });

        expect(typeof result.current.loadFiles).toBe('function');
        expect(typeof result.current.loadFile).toBe('function');
        expect(typeof result.current.removeFile).toBe('function');
        expect(typeof result.current.setFilters).toBe('function');
        expect(typeof result.current.clearSelectedFile).toBe('function');
        expect(typeof result.current.saveNursingHandoff).toBe('function');
        expect(typeof result.current.checkExists).toBe('function');
    });

    it('should load files on mount', async () => {
        const { result } = renderHook(() => useBackupFiles());

        await waitFor(() => {
            expect(result.current.isLoading).toBe(false);
        });

        expect(backupService.listBackupFiles).toHaveBeenCalled();
    });

    it('should load single file', async () => {
        const { result } = renderHook(() => useBackupFiles());

        await waitFor(() => {
            expect(result.current.isLoading).toBe(false);
        });

        await act(async () => {
            await result.current.loadFile('test-1');
        });

        expect(backupService.getBackupFile).toHaveBeenCalledWith('test-1');
    });

    it('should clear selected file', async () => {
        const { result } = renderHook(() => useBackupFiles());

        await waitFor(() => {
            expect(result.current.isLoading).toBe(false);
        });

        act(() => {
            result.current.clearSelectedFile();
        });

        expect(result.current.selectedFile).toBeNull();
    });

    it('should delete file', async () => {
        const { result } = renderHook(() => useBackupFiles());

        await waitFor(() => {
            expect(result.current.isLoading).toBe(false);
        });

        await act(async () => {
            const success = await result.current.removeFile('test-1');
            expect(success).toBe(true);
        });

        expect(backupService.deleteBackupFile).toHaveBeenCalledWith('test-1');
    });

    it('should check if backup exists', async () => {
        const { result } = renderHook(() => useBackupFiles());

        await waitFor(() => {
            expect(result.current.isLoading).toBe(false);
        });

        await act(async () => {
            const exists = await result.current.checkExists('2024-12-28', 'night');
            expect(exists).toBe(false);
        });

        expect(backupService.checkBackupExists).toHaveBeenCalledWith('2024-12-28', 'night');
    });

    it('should set filters', async () => {
        const { result } = renderHook(() => useBackupFiles());

        await waitFor(() => {
            expect(result.current.isLoading).toBe(false);
        });

        act(() => {
            result.current.setFilters({ type: 'NURSING_HANDOFF' });
        });

        expect(result.current.filters).toEqual({ type: 'NURSING_HANDOFF' });
    });
});
