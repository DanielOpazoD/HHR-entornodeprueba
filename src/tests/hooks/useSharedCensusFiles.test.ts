import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useSharedCensusFiles } from '@/hooks/useSharedCensusFiles';
import type { StoredCensusFile } from '@/services/backup/censusStorageService';

const mockedListCensusFilesInMonth = vi.fn();
const mockedLogAccess = vi.fn();

vi.mock('@/services/backup/censusStorageService', () => ({
  listCensusFilesInMonth: (...args: unknown[]) => mockedListCensusFilesInMonth(...args),
}));

vi.mock('@/services/census/censusAccessService', () => ({
  logAccess: (...args: unknown[]) => mockedLogAccess(...args),
}));

describe('useSharedCensusFiles', () => {
  const accessUser = {
    id: 'user-1',
    email: 'viewer@example.com',
    displayName: 'Viewer',
    role: 'viewer' as const,
    createdAt: new Date(),
    createdBy: 'admin',
    expiresAt: new Date(),
    isActive: true,
  };

  const sampleFile: StoredCensusFile = {
    name: '10-02-2026 - Censo Diario.xlsx',
    fullPath: '/censo/2026/02/file.xlsx',
    downloadUrl: 'https://example.com/file.xlsx',
    date: '2026-02-10',
    createdAt: '2026-02-10T08:00:00.000Z',
    size: 1200,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockedListCensusFilesInMonth.mockResolvedValue([]);
  });

  it('uses runtime alert for unauthorized download attempts', async () => {
    const runtime = {
      alert: vi.fn(),
      open: vi.fn(),
    };

    const { result } = renderHook(() => useSharedCensusFiles(accessUser, runtime));

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    await act(async () => {
      await result.current.handlers.handleDownload(sampleFile);
    });

    expect(runtime.alert).toHaveBeenCalledWith(
      'No tienes permisos de descarga. Contacta al administrador si necesitas el archivo.'
    );
    expect(runtime.open).not.toHaveBeenCalled();
  });

  it('uses runtime open for downloader role', async () => {
    const runtime = {
      alert: vi.fn(),
      open: vi.fn(),
    };
    const downloaderUser = { ...accessUser, role: 'downloader' as const };

    const { result } = renderHook(() => useSharedCensusFiles(downloaderUser, runtime));

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    await act(async () => {
      await result.current.handlers.handleDownload(sampleFile);
    });

    expect(runtime.open).toHaveBeenCalledWith('https://example.com/file.xlsx', '_blank');
    expect(mockedLogAccess).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'download_file',
        fileName: sampleFile.name,
      })
    );
  });

  it('surfaces typed load error when month listing fails', async () => {
    const runtime = {
      alert: vi.fn(),
      open: vi.fn(),
    };
    mockedListCensusFilesInMonth.mockRejectedValue(new Error('failed'));

    const { result } = renderHook(() => useSharedCensusFiles(accessUser, runtime));

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
      expect(result.current.loadError).toBe('No se pudieron cargar los archivos del censo.');
    });
  });

  it('ignores stale fetch responses when a newer fetch is in flight', async () => {
    let resolveFirstCurrent!: (files: StoredCensusFile[]) => void;
    let resolveFirstPrevious!: (files: StoredCensusFile[]) => void;

    const secondCurrent: StoredCensusFile[] = [
      {
        ...sampleFile,
        name: '12-02-2026 - Censo Diario.xlsx',
        fullPath: '/censo/2026/02/new-file.xlsx',
        date: '2026-02-12',
      },
    ];
    const secondPrevious: StoredCensusFile[] = [];

    mockedListCensusFilesInMonth
      .mockImplementationOnce(
        () =>
          new Promise<StoredCensusFile[]>(resolve => {
            resolveFirstCurrent = resolve;
          })
      )
      .mockImplementationOnce(
        () =>
          new Promise<StoredCensusFile[]>(resolve => {
            resolveFirstPrevious = resolve;
          })
      )
      .mockResolvedValueOnce(secondCurrent)
      .mockResolvedValueOnce(secondPrevious);

    const { result, rerender } = renderHook(({ user }) => useSharedCensusFiles(user), {
      initialProps: { user: accessUser },
    });

    rerender({ user: { ...accessUser, id: 'user-2', email: 'viewer2@example.com' } });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
      expect(result.current.filteredFiles[0]?.fullPath).toBe('/censo/2026/02/new-file.xlsx');
    });

    await act(async () => {
      resolveFirstCurrent([sampleFile]);
      resolveFirstPrevious([]);
    });

    expect(result.current.filteredFiles[0]?.fullPath).toBe('/censo/2026/02/new-file.xlsx');
  });
});
