import { afterEach, describe, expect, it, vi, beforeEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useSharedCensusFiles } from '@/hooks/useSharedCensusFiles';
import type { CensusAccessUser } from '@/types/censusAccess';
import type { StoredCensusFile } from '@/types/backupArtifacts';
import {
  executeLoadSharedCensusFiles,
  executeLogSharedCensusAccess,
} from '@/application/backup-export/sharedCensusFilesUseCases';

vi.mock('@/application/backup-export/sharedCensusFilesUseCases', () => ({
  executeLoadSharedCensusFiles: vi.fn(),
  executeLogSharedCensusAccess: vi.fn().mockResolvedValue(undefined),
}));

describe('useSharedCensusFiles', () => {
  const accessUser = {
    id: 'user-1',
    email: 'viewer@example.com',
    displayName: 'Viewer',
    role: 'viewer' as const,
    createdAt: new Date('2026-02-20T00:00:00.000Z'),
    createdBy: 'admin',
    expiresAt: new Date('2026-03-20T00:00:00.000Z'),
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

  afterEach(() => vi.restoreAllMocks());

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(executeLoadSharedCensusFiles).mockResolvedValue({
      status: 'success',
      data: [],
      issues: [],
    });
  });

  it('uses browser alert for unauthorized download attempts', async () => {
    const alert = vi.spyOn(window, 'alert').mockImplementation(() => undefined);
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);

    const { result } = renderHook(() => useSharedCensusFiles(accessUser));

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    await act(async () => {
      await result.current.handlers.handleDownload(sampleFile);
    });

    expect(alert).toHaveBeenCalledWith(
      'No tienes permisos de descarga. Contacta al administrador si necesitas el archivo.'
    );
    expect(open).not.toHaveBeenCalled();
  });

  it('opens an authorized download through the browser runtime', async () => {
    const alert = vi.spyOn(window, 'alert').mockImplementation(() => undefined);
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    const downloaderUser = { ...accessUser, role: 'downloader' as const };

    const { result } = renderHook(() => useSharedCensusFiles(downloaderUser));

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    await act(async () => {
      await result.current.handlers.handleDownload(sampleFile);
    });

    expect(alert).not.toHaveBeenCalled();
    expect(open).toHaveBeenCalledWith('https://example.com/file.xlsx', '_blank');
    expect(executeLogSharedCensusAccess).toHaveBeenCalledWith(
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
    vi.mocked(executeLoadSharedCensusFiles).mockResolvedValue({
      status: 'failed',
      data: [],
      issues: [{ kind: 'unknown', message: 'No se pudieron cargar los archivos del censo.' }],
    });

    const { result } = renderHook(() => useSharedCensusFiles(accessUser, runtime));

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
      expect(result.current.loadError).toBe('No se pudieron cargar los archivos del censo.');
    });
  });

  it('prefers userSafeMessage when shared census listing fails', async () => {
    const runtime = {
      alert: vi.fn(),
      open: vi.fn(),
    };
    vi.mocked(executeLoadSharedCensusFiles).mockResolvedValue({
      status: 'failed',
      data: [],
      userSafeMessage: 'La carpeta compartida no está disponible en este momento.',
      issues: [{ kind: 'unknown', message: 'Raw storage listing failure' }],
    });

    const { result } = renderHook(() => useSharedCensusFiles(accessUser, runtime));

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
      expect(result.current.loadError).toBe(
        'La carpeta compartida no está disponible en este momento.'
      );
    });
  });

  it('ignores stale fetch responses when a newer fetch is in flight', async () => {
    let resolveFirst!: (value: { status: 'success'; data: StoredCensusFile[]; issues: [] }) => void;

    const secondCurrent: StoredCensusFile[] = [
      {
        ...sampleFile,
        name: '12-02-2026 - Censo Diario.xlsx',
        fullPath: '/censo/2026/02/new-file.xlsx',
        date: '2026-02-12',
      },
    ];
    vi.mocked(executeLoadSharedCensusFiles)
      .mockImplementationOnce(
        () =>
          new Promise(resolve => {
            resolveFirst = resolve as typeof resolveFirst;
          })
      )
      .mockResolvedValueOnce({
        status: 'success',
        data: secondCurrent,
        issues: [],
      });

    const { result, rerender } = renderHook(({ user }) => useSharedCensusFiles(user), {
      initialProps: { user: accessUser },
    });

    rerender({ user: { ...accessUser, id: 'user-2', email: 'viewer2@example.com' } });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
      expect(result.current.filteredFiles[0]?.fullPath).toBe('/censo/2026/02/new-file.xlsx');
    });

    await act(async () => {
      resolveFirst({
        status: 'success',
        data: [sampleFile],
        issues: [],
      });
    });

    expect(result.current.filteredFiles[0]?.fullPath).toBe('/censo/2026/02/new-file.xlsx');
  });
  it.each(['success', 'failed'] as const)(
    'discards a pending %s response after access is removed',
    async status => {
      let resolveLoad!: (value: Awaited<ReturnType<typeof executeLoadSharedCensusFiles>>) => void;
      vi.mocked(executeLoadSharedCensusFiles).mockImplementationOnce(
        () =>
          new Promise(resolve => {
            resolveLoad = resolve;
          })
      );
      const { result, rerender } = renderHook(
        ({ user }: { user: CensusAccessUser | null }) => useSharedCensusFiles(user),
        { initialProps: { user: accessUser as CensusAccessUser | null } }
      );
      rerender({ user: null });
      await act(async () => {
        resolveLoad({ status, data: [sampleFile], issues: [] });
      });
      expect(result.current.files).toEqual([]);
      expect(result.current.loadError).toBeNull();
      expect(result.current.isLoading).toBe(false);
      expect(executeLogSharedCensusAccess).not.toHaveBeenCalled();
    }
  );
});
