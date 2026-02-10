import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import React from 'react';

// Mock dependencies before importing the hook
vi.mock('@/context/UIContext', () => ({
    useNotification: () => ({
        success: vi.fn(),
        error: vi.fn(),
    }),
    useConfirmDialog: () => ({
        confirm: vi.fn().mockResolvedValue(false),
    }),
}));

vi.mock('@/context/AuthContext', () => ({
    useAuth: () => ({
        role: 'admin',
    }),
}));

vi.mock('@/hooks/useBackupFilesQuery', () => ({
    useBackupFilesQuery: vi.fn().mockReturnValue({
        data: [],
        isLoading: false,
        isRefetching: false,
        refetch: vi.fn(),
    }),
}));

vi.mock('@/services/backup/pdfStorageService', () => ({
    deletePdf: vi.fn(),
}));

vi.mock('@/services/backup/censusStorageService', () => ({
    deleteCensusFile: vi.fn(),
}));

vi.mock('@/features/cudyr/services/cudyrStorageService', () => ({
    deleteCudyrFile: vi.fn(),
}));

import { useBackupFileBrowser } from '@/hooks/useBackupFileBrowser';

describe('useBackupFileBrowser', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should initialize with default values', () => {
        const { result } = renderHook(() => useBackupFileBrowser());

        expect(result.current.selectedBackupType).toBe('handoff');
        expect(result.current.path.length).toBe(2);
        expect(result.current.viewMode).toBe('grid');
        expect(result.current.searchQuery).toBe('');
        expect(result.current.canDelete).toBe(true);
    });

    it('should initialize with custom backup type', () => {
        const { result } = renderHook(() => useBackupFileBrowser('census'));

        expect(result.current.selectedBackupType).toBe('census');
    });

    it('should change view mode', () => {
        const { result } = renderHook(() => useBackupFileBrowser());

        act(() => {
            result.current.setViewMode('list');
        });

        expect(result.current.viewMode).toBe('list');
    });

    it('should update search query', () => {
        const { result } = renderHook(() => useBackupFileBrowser());

        act(() => {
            result.current.setSearchQuery('test');
        });

        expect(result.current.searchQuery).toBe('test');
    });

    it('should change backup type and reset path', () => {
        const { result } = renderHook(() => useBackupFileBrowser());

        act(() => {
            result.current.handlers.changeBackupType('cudyr');
        });

        expect(result.current.selectedBackupType).toBe('cudyr');
        expect(result.current.path.length).toBe(2);
    });

    it('should handle breadcrumb navigation', () => {
        const { result } = renderHook(() => useBackupFileBrowser());

        act(() => {
            result.current.handlers.handleBreadcrumbNavigate(0);
        });

        expect(result.current.path.length).toBe(1);
    });

    it('should handle folder click for year', () => {
        const { result } = renderHook(() => useBackupFileBrowser());

        act(() => {
            result.current.handlers.handleFolderClick({ name: '2023', type: 'year' });
        });

        expect(result.current.path).toEqual(['2023']);
    });
});
