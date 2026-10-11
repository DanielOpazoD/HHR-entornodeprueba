import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useExportManager } from '@/hooks/useExportManager';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import * as backupExportArchiveUseCases from '@/application/backup-export/backupExportArchiveUseCases';

const notificationApi = {
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
};

const confirmApi = {
  confirm: vi.fn().mockResolvedValue(true),
};

// Mock context
vi.mock('@/context/UIContext', () => ({
  useNotification: () => notificationApi,
  useConfirmDialog: () => confirmApi,
}));

vi.mock('@/application/backup-export/backupExportArchiveUseCases', async () => {
  const actual = await vi.importActual<
    typeof import('@/application/backup-export/backupExportArchiveUseCases')
  >('@/application/backup-export/backupExportArchiveUseCases');
  return {
    ...actual,
    executeExportHandoffPdf: vi.fn().mockResolvedValue({
      status: 'success',
      data: null,
      issues: [],
    }),
    executeBackupCensusExcel: vi.fn().mockResolvedValue({
      status: 'success',
      data: { archivedDate: '2024-12-28', recordCount: 1 },
      issues: [],
    }),
    executeBackupHandoffPdf: vi.fn().mockResolvedValue({
      status: 'success',
      data: { shift: 'day', createdCudyrBackup: false },
      issues: [],
    }),
  };
});

vi.mock('@/application/backup-export/backupExportStorageUseCases', async () => {
  const actual = await vi.importActual<
    typeof import('@/application/backup-export/backupExportStorageUseCases')
  >('@/application/backup-export/backupExportStorageUseCases');
  return {
    ...actual,
    executeLookupBackupArchiveStatus: vi.fn().mockResolvedValue({
      status: 'success',
      data: { exists: false, lookup: { exists: false, status: 'missing' } },
      issues: [],
    }),
  };
});

describe('useExportManager readiness', () => {
  const originalRequestIdleCallback = window.requestIdleCallback;
  const originalCancelIdleCallback = window.cancelIdleCallback;
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
    canVerifyArchiveStatus: true,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    notificationApi.success.mockReset();
    notificationApi.error.mockReset();
    notificationApi.warning.mockReset();
    confirmApi.confirm.mockReset();
    confirmApi.confirm.mockResolvedValue(true);
    window.requestIdleCallback = callback => {
      callback({
        didTimeout: false,
        timeRemaining: () => 50,
      } as IdleDeadline);
      return 1;
    };
    window.cancelIdleCallback = vi.fn();
  });

  afterEach(() => {
    vi.useRealTimers();
    window.requestIdleCallback = originalRequestIdleCallback;
    window.cancelIdleCallback = originalCancelIdleCallback;
  });

  it.each([
    'handleExportPDF',
    'handlePrintWithBrowserOptions',
    'handleBackupExcel',
    'handleBackupHandoff',
  ] as const)(
    'blocks %s when saving has not settled, without reporting a saved backup',
    async action => {
      const printSpy = vi.spyOn(window, 'print').mockImplementation(() => undefined);
      const { result } = renderHook(() =>
        useExportManager({
          ...defaultProps,
          canVerifyArchiveStatus: false,
          flushBeforeExport: async () => ({ status: 'blocked', reason: 'saving' }),
        })
      );
      await act(async () => {
        await result.current[action]();
      });
      expect(backupExportArchiveUseCases.executeExportHandoffPdf).not.toHaveBeenCalled();
      expect(backupExportArchiveUseCases.executeBackupCensusExcel).not.toHaveBeenCalled();
      expect(backupExportArchiveUseCases.executeBackupHandoffPdf).not.toHaveBeenCalled();
      expect(printSpy).not.toHaveBeenCalled();
      expect(notificationApi.warning).toHaveBeenCalledWith(
        'No se inició la exportación',
        expect.stringContaining('sigue guardándose')
      );
      expect(result.current.isArchived).toBe(false);
      expect(result.current.isBackingUp).toBe(false);
      printSpy.mockRestore();
    }
  );

  it('does not reuse a stale record after the stable getter returns null', async () => {
    const { result } = renderHook(() =>
      useExportManager({
        ...defaultProps,
        getStableRecordForExport: () => null,
      })
    );
    await act(async () => {
      await result.current.handleBackupExcel();
    });
    expect(backupExportArchiveUseCases.executeBackupCensusExcel).not.toHaveBeenCalled();
    expect(result.current.isBackingUp).toBe(false);
  });

  it('rejects a different census day returned after handoff confirmation', async () => {
    let stable = mockRecord;
    confirmApi.confirm.mockImplementation(async () => {
      stable = { ...mockRecord, date: '2024-12-29' };
      return true;
    });
    const { result } = renderHook(() =>
      useExportManager({
        ...defaultProps,
        getStableRecordForExport: () => stable,
      })
    );
    await act(async () => {
      await result.current.handleBackupHandoff();
    });
    expect(backupExportArchiveUseCases.executeBackupHandoffPdf).not.toHaveBeenCalled();
    expect(notificationApi.warning).toHaveBeenCalledWith(
      'No se inició la exportación',
      expect.stringContaining('Cambió el día')
    );
    expect(result.current.isBackingUp).toBe(false);
  });

  it('does not print the next census day during the print delay', async () => {
    vi.useFakeTimers();
    const printSpy = vi.spyOn(window, 'print').mockImplementation(() => undefined);
    let stable = mockRecord;
    const { result } = renderHook(() =>
      useExportManager({
        ...defaultProps,
        canVerifyArchiveStatus: false,
        getStableRecordForExport: () => stable,
      })
    );
    await act(async () => {
      await result.current.handlePrintWithBrowserOptions();
    });
    stable = { ...mockRecord, date: '2024-12-29' };
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(printSpy).not.toHaveBeenCalled();
    printSpy.mockRestore();
  });
  it('checks the committed date after rerender even without an optional live getter', async () => {
    vi.useFakeTimers();
    const printSpy = vi.spyOn(window, 'print').mockImplementation(() => undefined);
    const { result, rerender } = renderHook(props => useExportManager(props), {
      initialProps: { ...defaultProps, canVerifyArchiveStatus: false },
    });
    await act(async () => {
      await result.current.handlePrintWithBrowserOptions();
    });
    rerender({
      ...defaultProps,
      canVerifyArchiveStatus: false,
      currentDateString: '2024-12-29',
      record: { ...mockRecord, date: '2024-12-29' },
    });
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(printSpy).not.toHaveBeenCalled();
    printSpy.mockRestore();
  });

  it('does not print after leaving the export surface', async () => {
    vi.useFakeTimers();
    const printSpy = vi.spyOn(window, 'print').mockImplementation(() => undefined);
    const { result, unmount } = renderHook(() =>
      useExportManager({ ...defaultProps, canVerifyArchiveStatus: false })
    );
    await act(async () => {
      await result.current.handlePrintWithBrowserOptions();
    });
    unmount();
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(printSpy).not.toHaveBeenCalled();
    printSpy.mockRestore();
  });
});
