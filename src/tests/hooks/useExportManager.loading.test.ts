import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useExportManager } from '@/hooks/useExportManager';
import { DataFactory } from '@/tests/factories/DataFactory';

const mocks = vi.hoisted(() => ({
  error: vi.fn(),
  exportPdf: vi.fn().mockResolvedValue({ status: 'success', data: null, issues: [] }),
}));
vi.mock('@/context/UIContext', () => ({
  useNotification: () => ({ success: vi.fn(), warning: vi.fn(), error: mocks.error }),
  useConfirmDialog: () => ({ confirm: vi.fn() }),
}));
vi.mock('@/hooks/useBackupArchiveStatus', () => ({
  useBackupArchiveStatus: () => ({ isArchived: false, setIsArchived: vi.fn() }),
}));
vi.mock('@/services/runtime/createCachedRuntimeLoader', () => ({
  createCachedRuntimeLoader: () => async () => {
    throw new Error('synthetic chunk unavailable');
  },
}));
vi.mock('@/application/backup-export/backupExportArchiveUseCases', () => ({
  executeExportHandoffPdf: mocks.exportPdf,
  executeBackupCensusExcel: mocks.exportPdf,
  executeBackupHandoffPdf: mocks.exportPdf,
}));

describe('export action runtime loading', () => {
  beforeEach(() => vi.clearAllMocks());
  it.each([
    'handleExportPDF',
    'handlePrintWithBrowserOptions',
    'handleBackupExcel',
    'handleBackupHandoff',
  ] as const)('%s reports an unavailable runtime without claiming success', async action => {
    const { result } = renderHook(() =>
      useExportManager({
        currentDateString: '2026-11-10',
        selectedYear: 2026,
        selectedMonth: 10,
        selectedDay: 10,
        record: DataFactory.createMockDailyRecord('2026-11-10'),
        currentModule: 'CENSUS',
        selectedShift: 'day',
      })
    );
    await act(async () => {
      await result.current[action]();
    });
    expect(mocks.error).toHaveBeenCalledWith(
      'No se pudo cargar la exportación',
      'Vuelve a intentar la acción. No se generó ni guardó ningún archivo.'
    );
    expect(mocks.exportPdf).not.toHaveBeenCalled();
    expect(result.current.isBackingUp).toBe(false);
  });
});
