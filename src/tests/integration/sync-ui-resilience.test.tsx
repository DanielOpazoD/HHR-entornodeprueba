import type { DailyRecordRepositoryPort } from '@/application/ports/dailyRecordPort';
import { createUnconfirmedDailyRecordSubscriptionResult } from '@/tests/factories/dailyRecordSubscriptionResult';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useDailyRecordSyncQuery } from '@/hooks/useDailyRecordSyncQuery';
import { ConcurrencyError } from '@/services/storage/firestore';
import { createQueryClientTestWrapper } from '@/tests/utils/queryClientTestUtils';
import type { DailyRecord } from '@/types/domain/dailyRecord';

const mockSubscribe = vi.fn<DailyRecordRepositoryPort['subscribeDetailed']>();
const mockGetForDate = vi.fn();
const mockSave = vi.fn();
const mockUpdatePartial = vi.fn();

const mockNotifyError = vi.fn();
const { mockDailyRecordRepositoryPort } = vi.hoisted(() => ({
  mockDailyRecordRepositoryPort: {
    getForDate: vi.fn(),
    getForDateWithMeta: vi.fn(),
    save: vi.fn(),
    saveDetailed: vi.fn(),
    updatePartial: vi.fn(),
    updatePartialDetailed: vi.fn(),
    subscribeDetailed: vi.fn<DailyRecordRepositoryPort['subscribeDetailed']>(),
    initializeDay: vi.fn(),
    deleteDay: vi.fn(),
    getPreviousDay: vi.fn(),
    getPreviousDayWithMeta: vi.fn(),
    getAvailableDates: vi.fn(),
    getMonthRecords: vi.fn(),
    copyPatientToDateDetailed: vi.fn(),
    syncWithFirestore: vi.fn(),
    syncWithFirestoreDetailed: vi.fn(),
  },
}));

vi.mock('@/application/ports/dailyRecordPort', () => ({
  defaultDailyRecordReadPort: mockDailyRecordRepositoryPort,
  defaultDailyRecordWritePort: {
    updatePartial: mockDailyRecordRepositoryPort.updatePartialDetailed,
    save: mockDailyRecordRepositoryPort.saveDetailed,
    delete: mockDailyRecordRepositoryPort.deleteDay,
  },
  defaultDailyRecordSyncPort: {
    syncWithFirestoreDetailed: mockDailyRecordRepositoryPort.syncWithFirestoreDetailed,
  },
  defaultDailyRecordRepositoryPort: mockDailyRecordRepositoryPort,
}));

vi.mock('@/context/UIContext', () => ({
  useNotification: () => ({
    error: mockNotifyError,
    success: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
  }),
}));

const createWrapper = () => {
  const { wrapper } = createQueryClientTestWrapper();
  return wrapper;
};

const buildRecord = (date: string, name: string): DailyRecord =>
  ({
    date,
    beds: {
      R1: {
        bedId: 'R1',
        isBlocked: false,
        bedMode: 'Cama',
        hasCompanionCrib: false,
        patientName: name,
        rut: '11.111.111-1',
        age: '40a',
        pathology: 'Diag',
        specialty: 'Med Interna',
        status: 'Estable',
        admissionDate: date,
        hasWristband: false,
        devices: [],
        surgicalComplication: false,
        isUPC: false,
      },
    },
    discharges: [],
    transfers: [],
    cma: [],
    lastUpdated: `${date}T10:00:00.000Z`,
    nurses: [],
    activeExtraBeds: [],
  }) as unknown as DailyRecord;

describe('Sync UI Resilience Integration', () => {
  const date = '2026-02-19';
  const buildReadResult = (record: DailyRecord | null) => ({
    date,
    record,
    source: record ? ('indexeddb' as const) : ('not_found' as const),
    compatibilityTier: 'none' as const,
    compatibilityIntensity: 'none' as const,
    migrationRulesApplied: [],
    consistencyState: record ? ('local_only' as const) : ('missing' as const),
    sourceOfTruth: record ? ('local' as const) : ('none' as const),
    retryability: 'not_applicable' as const,
    recoveryAction: 'none' as const,
    conflictSummary: null,
    observabilityTags: ['daily_record', 'read'],
    repairApplied: false,
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockSave.mockResolvedValue(undefined);
    mockUpdatePartial.mockResolvedValue(undefined);
    mockDailyRecordRepositoryPort.getForDate.mockImplementation((requestDate: string) =>
      mockGetForDate(requestDate)
    );
    mockDailyRecordRepositoryPort.getForDateWithMeta.mockImplementation(async requestDate =>
      buildReadResult((await mockGetForDate(requestDate)) ?? null)
    );
    mockDailyRecordRepositoryPort.save.mockImplementation((record: DailyRecord) =>
      mockSave(record)
    );
    mockDailyRecordRepositoryPort.saveDetailed.mockImplementation((record: DailyRecord) =>
      mockSave(record)
    );
    mockDailyRecordRepositoryPort.updatePartial.mockImplementation((requestDate, partial) =>
      mockUpdatePartial(requestDate, partial)
    );
    mockDailyRecordRepositoryPort.updatePartialDetailed.mockImplementation((requestDate, partial) =>
      mockUpdatePartial(requestDate, partial)
    );
    mockDailyRecordRepositoryPort.subscribeDetailed.mockImplementation((requestDate, callback) => {
      mockSubscribe(requestDate, callback);
      return () => {};
    });
  });

  it('ignores remote echo updates while hasPendingWrites is true', async () => {
    const localRecord = buildRecord(date, 'Paciente Local');
    const remoteEcho = buildRecord(date, 'Paciente Remoto');
    mockGetForDate.mockResolvedValue(localRecord);

    const { result } = renderHook(() => useDailyRecordSyncQuery(date, false, 'ready'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.record?.beds.R1.patientName).toBe('Paciente Local');
    });

    await waitFor(() => {
      expect(mockSubscribe).toHaveBeenCalledWith(date, expect.any(Function));
    });

    const subscribeCallback = mockSubscribe.mock.calls[0][1];

    await act(async () => {
      subscribeCallback(createUnconfirmedDailyRecordSubscriptionResult(date, remoteEcho), true);
    });

    expect(result.current.record?.beds.R1.patientName).toBe('Paciente Local');
  });

  it('reports ConcurrencyError and schedules automatic refetch', async () => {
    const record = buildRecord(date, 'Paciente Local');
    mockGetForDate.mockResolvedValue(record);
    mockSave.mockRejectedValueOnce(new ConcurrencyError('Remote is newer'));

    const { result } = renderHook(() => useDailyRecordSyncQuery(date, false, 'ready'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.record).not.toBeNull();
    });

    await act(async () => {
      await result.current.saveAndUpdate(record).catch(() => undefined);
    });

    await waitFor(() => {
      expect(mockNotifyError).toHaveBeenCalledWith('Conflicto de Edición', 'Remote is newer');
      expect(result.current.syncStatus).toBe('error');
    });

    mockGetForDate.mockClear();

    await waitFor(
      () => {
        expect(mockGetForDate).toHaveBeenCalledWith(date);
      },
      { timeout: 3000 }
    );
  });

  it('rolls back optimistic patch when update fails with permission-denied', async () => {
    const originalRecord = buildRecord(date, 'Paciente Original');
    mockGetForDate.mockResolvedValue(originalRecord);
    mockUpdatePartial.mockRejectedValueOnce({
      code: 'permission-denied',
      message: 'Missing or insufficient permissions',
    });

    const { result } = renderHook(() => useDailyRecordSyncQuery(date, false, 'ready'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.record?.beds.R1.patientName).toBe('Paciente Original');
    });

    await act(async () => {
      await result.current
        .patchRecord({ 'beds.R1.patientName': 'Paciente Nuevo' })
        .catch(() => undefined);
    });

    await waitFor(() => {
      expect(result.current.syncStatus).toBe('error');
      expect(result.current.record?.beds.R1.patientName).toBe('Paciente Original');
    });
  });
});
