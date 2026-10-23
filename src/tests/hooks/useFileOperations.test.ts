import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useFileOperations } from '@/hooks/useFileOperations';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import * as ExportService from '@/services/exporters/exportService';
import * as backupExportMaintenanceUseCases from '@/application/backup-export/backupExportMaintenanceUseCases';

const notify = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn() }));

// Mock context
vi.mock('@/context/UIContext', () => ({
  useNotification: () => notify,
}));

// Mock export service
vi.mock('@/services/exporters/exportService', () => ({
  exportDataJSON: vi.fn(),
  exportDataJSONWithResult: vi.fn().mockResolvedValue({
    status: 'success',
    data: { exported: true },
    issues: [],
  }),
  exportDataCSV: vi.fn(),
  exportDataCSVWithResult: vi.fn().mockReturnValue({
    status: 'success',
    data: { exported: true },
    issues: [],
  }),
  importDataJSON: vi.fn().mockResolvedValue(true),
}));

vi.mock('@/application/backup-export/backupExportMaintenanceUseCases', () => ({
  executeImportJsonBackup: vi.fn().mockResolvedValue({
    status: 'success',
    data: {
      success: true,
      outcome: 'clean',
      importedCount: 1,
      repairedCount: 0,
      skippedEntries: [],
    },
    issues: [],
  }),
}));

describe('useFileOperations', () => {
  const mockRecord: DailyRecord = { date: '2024-12-28', beds: {} } as DailyRecord;
  const mockOnRefresh = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return all file operation functions', () => {
    const { result } = renderHook(() => useFileOperations(mockRecord, mockOnRefresh));

    expect(typeof result.current.handleExportJSON).toBe('function');
    expect(typeof result.current.handleExportCSV).toBe('function');
    expect(typeof result.current.handleImportJSON).toBe('function');
    expect(typeof result.current.handleImportFile).toBe('function');
  });

  it('should export JSON', async () => {
    const { result } = renderHook(() => useFileOperations(mockRecord, mockOnRefresh));

    act(() => {
      result.current.handleExportJSON();
    });

    await waitFor(() => {
      expect(ExportService.exportDataJSONWithResult).toHaveBeenCalled();
    });
  });

  it('warns, instead of reporting success, when the JSON backup is incomplete', async () => {
    vi.mocked(ExportService.exportDataJSONWithResult).mockResolvedValueOnce({
      status: 'partial',
      data: { exported: true },
      issues: [],
      userSafeMessage: 'El respaldo se generó sin los datos clínicos por episodio de 1 día.',
    });
    const { result } = renderHook(() => useFileOperations(mockRecord, mockOnRefresh));

    act(() => {
      result.current.handleExportJSON();
    });

    await waitFor(() => {
      expect(notify.warning).toHaveBeenCalledWith(
        'Respaldo incompleto',
        'El respaldo se generó sin los datos clínicos por episodio de 1 día.'
      );
    });
    expect(notify.success).not.toHaveBeenCalled();
    expect(notify.error).not.toHaveBeenCalled();
  });

  it('should export CSV', async () => {
    const { result } = renderHook(() => useFileOperations(mockRecord, mockOnRefresh));

    act(() => {
      result.current.handleExportCSV();
    });

    await waitFor(() => {
      expect(ExportService.exportDataCSVWithResult).toHaveBeenCalledWith(mockRecord);
    });
  });

  it('should import JSON file', async () => {
    const { result } = renderHook(() => useFileOperations(mockRecord, mockOnRefresh));

    const file = new File(['{}'], 'test.json', { type: 'application/json' });

    await act(async () => {
      await result.current.handleImportFile(file);
    });

    expect(backupExportMaintenanceUseCases.executeImportJsonBackup).toHaveBeenCalledWith(file);
    expect(mockOnRefresh).toHaveBeenCalled();
  });

  it('should reject non-JSON files', async () => {
    const { result } = renderHook(() => useFileOperations(mockRecord, mockOnRefresh));

    const file = new File(['data'], 'test.txt', { type: 'text/plain' });

    await act(async () => {
      await result.current.handleImportFile(file);
    });

    expect(backupExportMaintenanceUseCases.executeImportJsonBackup).not.toHaveBeenCalled();
  });
});
