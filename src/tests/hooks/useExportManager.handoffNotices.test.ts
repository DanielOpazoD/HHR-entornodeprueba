import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as backupExportArchiveUseCases from '@/application/backup-export/backupExportArchiveUseCases';
import { useExportManager } from '@/hooks/useExportManager';
import type { BackupHandoffPdfOutput } from '@/application/backup-export/backupExportArchiveContracts';
import type { ApplicationOutcome } from '@/shared/contracts/applicationOutcomeTypes';
import type { DailyRecord } from '@/types/domain/dailyRecord';

const notificationApi = {
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
};

const confirmApi = {
  confirm: vi.fn().mockResolvedValue(true),
};

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

describe('useExportManager handoff backup notices', () => {
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
    currentModule: 'NURSING_HANDOFF',
    selectedShift: 'day' as const,
    canVerifyArchiveStatus: false,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    notificationApi.success.mockReset();
    notificationApi.error.mockReset();
    notificationApi.warning.mockReset();
    confirmApi.confirm.mockReset();
    confirmApi.confirm.mockResolvedValue(true);
  });

  it('uses operational copy when the night CUDYR backup remains pending after saving the PDF', async () => {
    const partialNightBackup: ApplicationOutcome<BackupHandoffPdfOutput | null> = {
      status: 'partial',
      reason: 'backup_handoff_cudyr_storage_failed',
      data: { shift: 'night', createdCudyrBackup: false },
      issues: [
        {
          kind: 'permission',
          message: 'permission denied',
          userSafeMessage: 'PDF guardado, pero no tienes permisos para guardar CUDYR.',
        },
      ],
    };
    vi.mocked(backupExportArchiveUseCases.executeBackupHandoffPdf).mockResolvedValueOnce(
      partialNightBackup
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

    expect(notificationApi.warning).toHaveBeenCalledWith(
      'PDF guardado; CUDYR pendiente',
      'PDF guardado, pero no tienes permisos para guardar CUDYR.'
    );
    expect(result.current.isArchived).toBe(true);
  });

  it('uses blocking copy when the handoff PDF backup is not saved', async () => {
    const failedPdfBackup: ApplicationOutcome<BackupHandoffPdfOutput | null> = {
      status: 'failed',
      reason: 'backup_handoff_pdf_storage_failed',
      data: null,
      issues: [
        {
          kind: 'permission',
          message: 'permission denied',
          userSafeMessage: 'No tienes permisos para guardar el respaldo PDF.',
        },
      ],
    };
    vi.mocked(backupExportArchiveUseCases.executeBackupHandoffPdf).mockResolvedValueOnce(
      failedPdfBackup
    );

    const { result } = renderHook(() => useExportManager(defaultProps));

    await act(async () => {
      await result.current.handleBackupHandoff(true);
    });

    expect(notificationApi.error).toHaveBeenCalledWith(
      'No se guardó el respaldo PDF',
      'No tienes permisos para guardar el respaldo PDF.'
    );
    expect(result.current.isArchived).toBe(false);
  });
});
