import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useExportManager } from '@/hooks/useExportManager';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import * as backupExportArchiveUseCases from '@/application/backup-export/backupExportArchiveUseCases';
import * as backupExportStorageUseCases from '@/application/backup-export/backupExportStorageUseCases';
import type { ApplicationOutcome } from '@/shared/contracts/applicationOutcomeTypes';
import type { LookupBackupArchiveStatusOutput } from '@/application/backup-export/backupExportStorageUseCases';
import type { BackupHandoffPdfOutput } from '@/application/backup-export/backupExportArchiveContracts';

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

describe('useExportManager', () => {
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
    window.requestIdleCallback = originalRequestIdleCallback;
    window.cancelIdleCallback = originalCancelIdleCallback;
  });

  it('should return all export functions', () => {
    const { result } = renderHook(() =>
      useExportManager({ ...defaultProps, canVerifyArchiveStatus: false })
    );

    expect(typeof result.current.handleExportPDF).toBe('function');
    expect(typeof result.current.handlePrintWithBrowserOptions).toBe('function');
    expect(typeof result.current.handleBackupExcel).toBe('function');
    expect(typeof result.current.handleBackupHandoff).toBe('function');
    expect(result.current.isArchived).toBe(false);
    expect(result.current.isBackingUp).toBe(false);
  });

  it('opens browser print after flushing local handoff state for configurable Chrome print options', async () => {
    vi.useFakeTimers();
    const printSpy = vi.spyOn(window, 'print').mockImplementation(() => undefined);
    const flushBeforeExport = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() =>
      useExportManager({
        ...defaultProps,
        currentModule: 'NURSING_HANDOFF',
        flushBeforeExport,
      })
    );

    await act(async () => {
      await result.current.handlePrintWithBrowserOptions();
    });

    expect(flushBeforeExport).toHaveBeenCalledTimes(1);
    expect(printSpy).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(100);
    });

    expect(printSpy).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
    printSpy.mockRestore();
  });

  it('exports nursing handoff PDFs in print-preview mode', async () => {
    const flushBeforeExport = vi.fn().mockResolvedValue(undefined);
    const exportedRecord = { ...mockRecord, date: '2024-12-29' } as DailyRecord;
    const getStableRecordForExport = vi.fn().mockReturnValue(exportedRecord);
    const { result } = renderHook(() =>
      useExportManager({
        ...defaultProps,
        currentModule: 'NURSING_HANDOFF',
        flushBeforeExport,
        getStableRecordForExport,
      })
    );

    await act(async () => {
      await result.current.handleExportPDF();
    });

    expect(backupExportArchiveUseCases.executeExportHandoffPdf).toHaveBeenCalledWith({
      record: exportedRecord,
      selectedShift: 'day',
      isMedical: false,
    });
    expect(flushBeforeExport).toHaveBeenCalledTimes(1);
    expect(getStableRecordForExport).toHaveBeenCalledTimes(1);
  });

  it('exports medical handoff PDFs as local downloads', async () => {
    const { result } = renderHook(() =>
      useExportManager({
        ...defaultProps,
        currentModule: 'MEDICAL_HANDOFF',
      })
    );

    await act(async () => {
      await result.current.handleExportPDF();
    });

    expect(backupExportArchiveUseCases.executeExportHandoffPdf).toHaveBeenCalledWith({
      record: mockRecord,
      selectedShift: 'day',
      isMedical: true,
    });
  });

  it('should check archive status on mount for CENSUS module', async () => {
    renderHook(() => useExportManager(defaultProps));

    await waitFor(() => {
      expect(backupExportStorageUseCases.executeLookupBackupArchiveStatus).toHaveBeenCalledWith({
        backupType: 'census',
        date: '2024-12-28',
        shift: 'day',
      });
    });
  });

  it('should check archive status for NURSING_HANDOFF module', async () => {
    const props = {
      ...defaultProps,
      currentModule: 'NURSING_HANDOFF',
    };

    renderHook(() => useExportManager(props));

    await waitFor(() => {
      expect(backupExportStorageUseCases.executeLookupBackupArchiveStatus).toHaveBeenCalledWith({
        backupType: 'handoff',
        date: '2024-12-28',
        shift: 'day',
      });
    });
  });

  it('resets the archived state when switching modules before the next lookup resolves', async () => {
    vi.mocked(backupExportStorageUseCases.executeLookupBackupArchiveStatus).mockResolvedValueOnce({
      status: 'success',
      data: { exists: true, lookup: { exists: true, status: 'available' } },
      issues: [],
    });

    const { result, rerender } = renderHook(props => useExportManager(props), {
      initialProps: defaultProps,
    });

    await waitFor(() => {
      expect(result.current.isArchived).toBe(true);
    });

    vi.mocked(backupExportStorageUseCases.executeLookupBackupArchiveStatus).mockImplementationOnce(
      () => new Promise(() => {})
    );

    rerender({
      ...defaultProps,
      currentModule: 'NURSING_HANDOFF',
    });

    await waitFor(() => {
      expect(result.current.isArchived).toBe(false);
    });
  });

  it('should handle null record', () => {
    const props = {
      ...defaultProps,
      record: null,
    };

    const { result } = renderHook(() =>
      useExportManager({ ...props, canVerifyArchiveStatus: false })
    );

    expect(result.current.handleExportPDF).toBeDefined();
  });

  it('backs up census excel from the resolved stable snapshot', async () => {
    const flushBeforeExport = vi.fn().mockResolvedValue(undefined);
    const exportedRecord = { ...mockRecord, date: '2024-12-30' } as DailyRecord;
    const getStableRecordForExport = vi.fn().mockReturnValue(exportedRecord);
    const { result } = renderHook(() =>
      useExportManager({
        ...defaultProps,
        flushBeforeExport,
        getStableRecordForExport,
      })
    );

    await act(async () => {
      await result.current.handleBackupExcel();
    });

    expect(flushBeforeExport).toHaveBeenCalledTimes(1);
    expect(getStableRecordForExport).toHaveBeenCalledTimes(1);
    expect(backupExportArchiveUseCases.executeBackupCensusExcel).toHaveBeenCalledWith({
      selectedYear: 2024,
      selectedMonth: 11,
      selectedDay: 28,
      currentDateString: '2024-12-28',
      record: exportedRecord,
    });
  });

  it('keeps degraded timeout lookup silent on mount', async () => {
    const degradedLookup: ApplicationOutcome<LookupBackupArchiveStatusOutput> = {
      status: 'degraded',
      data: { exists: false, lookup: { exists: false, status: 'timeout' } },
      issues: [{ kind: 'unknown', message: 'Storage tardó demasiado' }],
    };
    vi.mocked(backupExportStorageUseCases.executeLookupBackupArchiveStatus).mockResolvedValue(
      degradedLookup
    );

    renderHook(() => useExportManager(defaultProps));

    await waitFor(() => {
      expect(backupExportStorageUseCases.executeLookupBackupArchiveStatus).toHaveBeenCalled();
    });

    expect(notificationApi.warning).not.toHaveBeenCalled();
    expect(notificationApi.error).not.toHaveBeenCalled();
  });

  it('still surfaces blocking lookup failures on mount', async () => {
    const failedLookup: ApplicationOutcome<LookupBackupArchiveStatusOutput> = {
      status: 'failed',
      data: { exists: false, lookup: { exists: false, status: 'error' } },
      userSafeMessage: 'La verificación remota no está disponible por ahora.',
      issues: [{ kind: 'unknown', message: 'lookup failed' }],
    };
    vi.mocked(backupExportStorageUseCases.executeLookupBackupArchiveStatus).mockResolvedValueOnce(
      failedLookup
    );

    renderHook(() => useExportManager(defaultProps));

    await waitFor(() => {
      expect(notificationApi.error).toHaveBeenCalledWith(
        'Verificación de respaldo fallida',
        'La verificación remota no está disponible por ahora.'
      );
    });
  });

  it('treats a missing lookup as a non-fatal unarchived state', async () => {
    const missingLookup: ApplicationOutcome<LookupBackupArchiveStatusOutput> = {
      status: 'success',
      data: { exists: false, lookup: { exists: false, status: 'missing' } },
      issues: [],
    };
    vi.mocked(backupExportStorageUseCases.executeLookupBackupArchiveStatus).mockResolvedValueOnce(
      missingLookup
    );

    const { result } = renderHook(() => useExportManager(defaultProps));

    await waitFor(() => {
      expect(result.current.isArchived).toBe(false);
    });

    expect(notificationApi.warning).not.toHaveBeenCalled();
    expect(notificationApi.error).not.toHaveBeenCalled();
  });

  it('surfaces partial handoff backup and still marks archive state', async () => {
    const partialHandoffBackup: ApplicationOutcome<BackupHandoffPdfOutput | null> = {
      status: 'partial',
      data: { shift: 'day', createdCudyrBackup: false },
      issues: [{ kind: 'unknown', message: 'CUDYR mensual no pudo guardarse.' }],
    };
    vi.mocked(backupExportArchiveUseCases.executeBackupHandoffPdf).mockResolvedValueOnce(
      partialHandoffBackup
    );

    const { result } = renderHook(() =>
      useExportManager({
        ...defaultProps,
        currentModule: 'NURSING_HANDOFF',
      })
    );

    await waitFor(() => {
      expect(result.current.isArchived).toBeDefined();
    });

    await act(async () => {
      await result.current.handleBackupHandoff(true);
    });

    await waitFor(() => {
      expect(notificationApi.warning).toHaveBeenCalledWith(
        'Respaldo PDF guardado con observaciones',
        expect.stringContaining('CUDYR mensual')
      );
      expect(result.current.isArchived).toBe(true);
    });
  });

  it('shows a warning notice when export PDF completes with a partial outcome', async () => {
    vi.mocked(backupExportArchiveUseCases.executeExportHandoffPdf).mockResolvedValueOnce({
      status: 'partial',
      data: null,
      userSafeMessage: 'Se abrió la vista previa con advertencias.',
      issues: [{ kind: 'unknown', message: 'warning' }],
    });

    const { result } = renderHook(() => useExportManager(defaultProps));

    await act(async () => {
      await result.current.handleExportPDF();
    });

    expect(notificationApi.warning).toHaveBeenCalledWith(
      'Impresión abierta con observaciones',
      'warning'
    );
  });

  it('marks census backup as archived after a partial backup outcome', async () => {
    vi.mocked(backupExportArchiveUseCases.executeBackupCensusExcel).mockResolvedValueOnce({
      status: 'partial',
      data: { archivedDate: '2024-12-28', recordCount: 1 },
      userSafeMessage: 'Guardado local con observaciones.',
      issues: [{ kind: 'unknown', message: 'partial' }],
    });

    const { result } = renderHook(() => useExportManager(defaultProps));

    await act(async () => {
      await result.current.handleBackupExcel();
    });

    expect(result.current.isArchived).toBe(true);
    expect(notificationApi.warning).toHaveBeenCalled();
  });

  it('skips handoff backup when there is no stable record to export', async () => {
    const { result } = renderHook(() =>
      useExportManager({
        ...defaultProps,
        record: null,
        getStableRecordForExport: () => null,
      })
    );

    await act(async () => {
      await result.current.handleBackupHandoff(true);
    });

    expect(backupExportArchiveUseCases.executeBackupHandoffPdf).not.toHaveBeenCalled();
  });

  it('cancels handoff backup when the confirmation dialog is rejected', async () => {
    confirmApi.confirm.mockResolvedValueOnce(false);
    const { result } = renderHook(() => useExportManager(defaultProps));

    await act(async () => {
      await result.current.handleBackupHandoff();
    });

    expect(confirmApi.confirm).toHaveBeenCalledTimes(1);
    expect(backupExportArchiveUseCases.executeBackupHandoffPdf).not.toHaveBeenCalled();
  });

  it('uses the night-shift success copy when handoff backup succeeds', async () => {
    const nightOutcome: ApplicationOutcome<BackupHandoffPdfOutput> = {
      status: 'success',
      data: { shift: 'night', createdCudyrBackup: true },
      issues: [],
    };
    vi.mocked(backupExportArchiveUseCases.executeBackupHandoffPdf).mockResolvedValueOnce(
      nightOutcome
    );

    const { result } = renderHook(() =>
      useExportManager({
        ...defaultProps,
        selectedShift: 'night',
      })
    );

    await act(async () => {
      await result.current.handleBackupHandoff(true);
    });

    expect(notificationApi.success).toHaveBeenCalledWith(
      'Respaldos guardados',
      'PDF + CUDYR mensual'
    );
    expect(result.current.isArchived).toBe(true);
  });
});
