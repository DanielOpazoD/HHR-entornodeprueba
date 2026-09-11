import { act, renderHook, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useDailyRecordSyncQuery } from '@/hooks/useDailyRecordSyncQuery';
import { defaultDailyRecordRepositoryPort } from '@/application/ports/dailyRecordPort';
import { createQueryClientTestWrapper } from '@/tests/utils/queryClientTestUtils';
import { DataFactory } from '@/tests/factories/DataFactory';
import { UIProvider } from '@/context/UIContext';
import { createSaveDailyRecordResult } from '@/services/repositories/contracts/dailyRecordResults';

const { repository } = vi.hoisted(() => ({
  repository: {
    getForDate: vi.fn(),
    getForDateWithMeta: vi.fn(),
    save: vi.fn(),
    saveDetailed: vi.fn(),
    subscribe: vi.fn(() => vi.fn()),
    subscribeDetailed: vi.fn(() => vi.fn()),
    updatePartial: vi.fn(),
    updatePartialDetailed: vi.fn(),
    syncWithFirestoreDetailed: vi.fn(),
    initializeDay: vi.fn(),
    deleteDay: vi.fn(),
    getPreviousDay: vi.fn(),
    getPreviousDayWithMeta: vi.fn(),
    getAvailableDates: vi.fn(),
    getMonthRecords: vi.fn(),
    copyPatientToDateDetailed: vi.fn(),
  },
}));

vi.mock('@/utils/dateCoreUtils', async () => ({
  ...(await vi.importActual('@/utils/dateCoreUtils')),
  getTodayISO: () => '2025-12-27',
}));

vi.mock('@/application/ports/dailyRecordPort', () => ({
  defaultDailyRecordReadPort: repository,
  defaultDailyRecordWritePort: {
    updatePartial: repository.updatePartialDetailed,
    save: repository.saveDetailed,
    delete: repository.deleteDay,
  },
  defaultDailyRecordSyncPort: {
    syncWithFirestoreDetailed: repository.syncWithFirestoreDetailed,
  },
  defaultDailyRecordRepositoryPort: repository,
}));

vi.mock('@/services/RepositoryContext', async importOriginal => ({
  ...(await importOriginal<typeof import('@/services/RepositoryContext')>()),
  useRepositories: () => ({ dailyRecord: repository }),
}));

vi.mock('@/context/VersionContext', () => ({
  useVersion: () => ({ checkVersion: vi.fn(), currentVersion: 1, isOutdated: false }),
}));

vi.mock('@/application/daily-record/syncDailyRecordUseCase', () => ({
  executeSyncDailyRecord: vi.fn().mockResolvedValue({
    success: true,
    data: { date: '2025-12-27', outcome: 'clean', record: null },
  }),
}));

const mockDate = '2025-12-27';
const mockRecord = DataFactory.createMockDailyRecord(mockDate, {
  beds: {},
  lastUpdated: '2026-01-01T00:00:00.000Z',
  discharges: [],
  transfers: [],
  cma: [],
  nurses: [],
  activeExtraBeds: [],
});

const buildReadResult = () => ({
  date: mockDate,
  record: mockRecord,
  source: 'indexeddb' as const,
  compatibilityTier: 'none' as const,
  compatibilityIntensity: 'none' as const,
  migrationRulesApplied: [],
  consistencyState: 'local_only' as const,
  sourceOfTruth: 'local' as const,
  retryability: 'not_applicable' as const,
  recoveryAction: 'none' as const,
  conflictSummary: null,
  observabilityTags: ['daily_record', 'read'],
  repairApplied: false,
});

const createWrapper = () =>
  createQueryClientTestWrapper({
    wrapChildren: children => <UIProvider>{children}</UIProvider>,
  }).wrapper;

describe('useDailyRecordSyncQuery notification ownership', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(defaultDailyRecordRepositoryPort.getForDateWithMeta).mockResolvedValue(
      buildReadResult()
    );
    vi.mocked(defaultDailyRecordRepositoryPort.saveDetailed).mockResolvedValue(
      createSaveDailyRecordResult({
        date: mockDate,
        outcome: 'clean',
        savedLocally: true,
        savedRemotely: true,
        queuedForRetry: false,
        autoMerged: false,
      })
    );
  });

  it('emits exactly one truthful notice for a server-confirmed save', async () => {
    const { result } = renderHook(() => useDailyRecordSyncQuery(mockDate, false, 'ready'), {
      wrapper: createWrapper(),
    });
    await waitFor(() => expect(result.current.record).not.toBeNull());

    await act(async () => {
      await result.current.saveAndUpdate({
        ...mockRecord,
        lastUpdated: '2026-01-01T00:00:02.000Z',
      });
    });

    expect(screen.getAllByText('Censo guardado')).toHaveLength(1);
    expect(screen.getAllByText('Los cambios quedaron confirmados en el servidor.')).toHaveLength(1);
    expect(screen.queryByText(/se guardaron localmente/i)).not.toBeInTheDocument();
  });

  it('emits exactly one non-committal notice when a patch fails completely', async () => {
    vi.mocked(defaultDailyRecordRepositoryPort.updatePartialDetailed).mockRejectedValueOnce(
      new Error('storage unavailable')
    );
    const { result } = renderHook(() => useDailyRecordSyncQuery(mockDate, false, 'ready'), {
      wrapper: createWrapper(),
    });
    await waitFor(() => expect(result.current.record).not.toBeNull());

    await act(async () => {
      await expect(result.current.patchRecord({ nurses: [] })).rejects.toThrow(
        'storage unavailable'
      );
    });

    expect(screen.getAllByText('Cambio no guardado')).toHaveLength(1);
    expect(
      screen.getAllByText(
        'No fue posible completar la actualización. El cambio no quedó confirmado; revisa el censo antes de reintentar.'
      )
    ).toHaveLength(1);
    expect(screen.queryByText(/los cambios se guardaron localmente/i)).not.toBeInTheDocument();
  });

  it('emits exactly one rejection notice when a resolved save outcome is blocked', async () => {
    vi.mocked(defaultDailyRecordRepositoryPort.saveDetailed).mockResolvedValueOnce(
      createSaveDailyRecordResult({
        date: mockDate,
        outcome: 'blocked',
        savedLocally: false,
        savedRemotely: false,
        queuedForRetry: false,
        autoMerged: false,
        blockingReason: 'validation',
      })
    );
    const { result } = renderHook(() => useDailyRecordSyncQuery(mockDate, false, 'ready'), {
      wrapper: createWrapper(),
    });
    await waitFor(() => expect(result.current.record).not.toBeNull());

    await act(async () => {
      await expect(result.current.saveAndUpdate(mockRecord)).rejects.toThrow(
        'La operación quedó bloqueada por una validación de consistencia.'
      );
    });

    expect(screen.getAllByText('Guardado bloqueado')).toHaveLength(1);
    expect(screen.getAllByText('La operación fue rechazada y no quedó confirmada.')).toHaveLength(
      1
    );
    expect(screen.queryByText('Error de sincronización')).not.toBeInTheDocument();
  });
});
