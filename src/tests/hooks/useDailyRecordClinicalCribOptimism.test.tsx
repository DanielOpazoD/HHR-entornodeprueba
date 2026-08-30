import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { UIProvider } from '@/context/UIContext';
import { useDailyRecordSyncQuery } from '@/hooks/useDailyRecordSyncQuery';
import { defaultDailyRecordRepositoryPort } from '@/application/ports/dailyRecordPort';
import { createQueryClientTestWrapper } from '@/tests/utils/queryClientTestUtils';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import { DataFactory } from '@/tests/factories/DataFactory';
import { createUpdatePartialDailyRecordResult } from '@/services/repositories/contracts/dailyRecordResults';
import { buildConfirmedBedOccupantIdentity } from '@/hooks/controllers/intentionalBedClearController';

const { mockDailyRecordRepositoryPort } = vi.hoisted(() => ({
  mockDailyRecordRepositoryPort: {
    getForDate: vi.fn(),
    getForDateWithMeta: vi.fn(),
    getAuthoritativeForDate: vi.fn(),
    adoptAuthoritativeRecord: vi.fn(async record => record),
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

vi.mock('@/services/RepositoryContext', async importOriginal => ({
  ...(await importOriginal<typeof import('@/services/RepositoryContext')>()),
  useRepositories: () => ({ dailyRecord: mockDailyRecordRepositoryPort }),
}));

vi.mock('@/context/VersionContext', () => ({
  useVersion: () => ({ checkVersion: vi.fn(), currentVersion: 1, isOutdated: false }),
}));

const mockExecuteSyncDailyRecord = vi.hoisted(() => vi.fn());
vi.mock('@/application/daily-record/syncDailyRecordUseCase', () => ({
  executeSyncDailyRecord: mockExecuteSyncDailyRecord,
}));

const mockDate = '2025-12-27';
const mockRecord: DailyRecord = DataFactory.createMockDailyRecord(mockDate, {
  beds: {},
  lastUpdated: '2026-01-01T00:00:00.000Z',
  discharges: [],
  transfers: [],
  cma: [],
  nurses: [],
  activeExtraBeds: [],
});

const buildReadResult = (record: DailyRecord) => ({
  date: mockDate,
  record,
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

const createDeferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

const createWrapper = () =>
  createQueryClientTestWrapper({ wrapChildren: children => <UIProvider>{children}</UIProvider> })
    .wrapper;

const buildClinicalCribCreateOptions = (record: DailyRecord, bedId = 'R1') => ({
  consistency: 'remote_confirmed' as const,
  optimisticRemoteConfirmed: true,
  clinicalCribCreate: {
    bedId,
    confirmedLastUpdated: record.lastUpdated,
    confirmedParent: buildConfirmedBedOccupantIdentity(record.beds[bedId]),
  },
});

describe('remote-confirmed clinical crib optimism', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
    mockExecuteSyncDailyRecord.mockResolvedValue({
      success: true,
      data: { date: mockDate, outcome: 'clean', record: null },
    });
    mockDailyRecordRepositoryPort.getAuthoritativeForDate.mockImplementation(async date => {
      const result = await mockDailyRecordRepositoryPort.getForDateWithMeta(date, true);
      return result.record;
    });
  });

  afterEach(() => vi.useRealTimers());

  it('shows a newly added clinical crib immediately and rolls it back on remote rejection', async () => {
    const occupiedRecord = DataFactory.createMockDailyRecord(mockDate, {
      ...mockRecord,
      beds: {
        R1: DataFactory.createMockPatient('R1', {
          patientName: 'Paciente principal',
          clinicalCrib: undefined,
        }),
      },
    });
    const newCrib = DataFactory.createMockPatient('R1', {
      bedMode: 'Cuna',
      patientName: 'RN de Paciente principal',
      rut: '',
    });
    const write = createDeferred<ReturnType<typeof createUpdatePartialDailyRecordResult>>();
    vi.mocked(defaultDailyRecordRepositoryPort.getForDateWithMeta).mockResolvedValue(
      buildReadResult(occupiedRecord)
    );
    vi.mocked(defaultDailyRecordRepositoryPort.updatePartialDetailed).mockImplementation(
      () => write.promise
    );

    const { result } = renderHook(() => useDailyRecordSyncQuery(mockDate, false, 'ready'), {
      wrapper: createWrapper(),
    });
    await waitFor(() => {
      expect(result.current.record?.beds.R1.patientName).toBe('Paciente principal');
    });
    vi.mocked(defaultDailyRecordRepositoryPort.getForDateWithMeta).mockClear();

    let createPromise!: Promise<void>;
    act(() => {
      createPromise = result.current.patchRecord(
        { 'beds.R1.clinicalCrib': newCrib },
        buildClinicalCribCreateOptions(occupiedRecord)
      );
    });

    await waitFor(() => {
      expect(result.current.record?.beds.R1.clinicalCrib?.patientName).toBe(
        'RN de Paciente principal'
      );
    });
    expect(defaultDailyRecordRepositoryPort.getForDateWithMeta).toHaveBeenCalledWith(
      mockDate,
      true
    );
    expect(defaultDailyRecordRepositoryPort.updatePartialDetailed).toHaveBeenCalledWith(
      mockDate,
      { 'beds.R1.clinicalCrib': newCrib },
      expect.objectContaining({
        requireConfirmedRecord: true,
        requireRemoteAuthorityFirst: true,
        requireAtomicCas: true,
      })
    );

    write.reject(new Error('remote unavailable'));
    await expect(createPromise).rejects.toThrow('remote unavailable');
    await waitFor(() => {
      expect(result.current.record?.beds.R1.clinicalCrib).toBeUndefined();
    });
  });

  it('replaces its own optimistic timestamp with the server-confirmed crib revision', async () => {
    const occupiedRecord = DataFactory.createMockDailyRecord(mockDate, {
      ...mockRecord,
      beds: {
        R1: DataFactory.createMockPatient('R1', {
          patientName: 'Paciente principal',
          clinicalEpisodeId: 'parent-episode',
          clinicalCrib: undefined,
        }),
      },
    });
    const newCrib = DataFactory.createMockPatient('R1', {
      bedMode: 'Cuna',
      identityStatus: 'provisional',
      patientName: 'RN de Paciente principal',
      rut: '',
      clinicalEpisodeId: 'ep-new-crib',
    });
    const authoritativeBase = {
      ...occupiedRecord,
      lastUpdated: '2026-01-01T00:00:00.500Z',
    };
    const confirmedRecord = DataFactory.createMockDailyRecord(mockDate, {
      ...occupiedRecord,
      beds: { R1: { ...occupiedRecord.beds.R1, clinicalCrib: newCrib } },
      lastUpdated: '2026-01-01T00:00:01.000Z',
    });
    const write = createDeferred<ReturnType<typeof createUpdatePartialDailyRecordResult>>();
    vi.mocked(defaultDailyRecordRepositoryPort.getForDateWithMeta).mockResolvedValue(
      buildReadResult(occupiedRecord)
    );
    vi.mocked(defaultDailyRecordRepositoryPort.updatePartialDetailed).mockImplementation(
      () => write.promise
    );
    vi.mocked(defaultDailyRecordRepositoryPort.getAuthoritativeForDate).mockResolvedValue(
      authoritativeBase
    );

    const { result } = renderHook(() => useDailyRecordSyncQuery(mockDate, false, 'local_only'), {
      wrapper: createWrapper(),
    });
    await waitFor(() => {
      expect(result.current.record?.beds.R1.patientName).toBe('Paciente principal');
    });

    let createPromise!: Promise<void>;
    act(() => {
      createPromise = result.current.patchRecord(
        { 'beds.R1.clinicalCrib': newCrib },
        buildClinicalCribCreateOptions(occupiedRecord)
      );
    });
    await waitFor(() => {
      expect(result.current.record?.beds.R1.clinicalCrib?.clinicalEpisodeId).toBe('ep-new-crib');
    });
    expect(defaultDailyRecordRepositoryPort.updatePartialDetailed).toHaveBeenCalledWith(
      mockDate,
      { 'beds.R1.clinicalCrib': newCrib },
      expect.objectContaining({
        baseRecord: authoritativeBase,
        clinicalCribCreate: expect.objectContaining({
          confirmedLastUpdated: authoritativeBase.lastUpdated,
          confirmedParent: expect.objectContaining({ clinicalEpisodeId: 'parent-episode' }),
        }),
      })
    );

    write.resolve(
      createUpdatePartialDailyRecordResult({
        date: mockDate,
        outcome: 'clean',
        savedLocally: true,
        updatedRemotely: true,
        queuedForRetry: false,
        autoMerged: false,
        patchedFields: 1,
        confirmedRecord,
      })
    );
    await act(async () => createPromise);

    await waitFor(() => {
      expect(result.current.record?.lastUpdated).toBe(confirmedRecord.lastUpdated);
      expect(result.current.record?.beds.R1.clinicalCrib?.clinicalEpisodeId).toBe('ep-new-crib');
    });
  });

  it('publishes the remote crib without writing when another tab creates it first', async () => {
    const occupiedRecord = DataFactory.createMockDailyRecord(mockDate, {
      ...mockRecord,
      beds: {
        R1: DataFactory.createMockPatient('R1', {
          patientName: 'Paciente principal',
          clinicalEpisodeId: 'parent-episode',
          clinicalCrib: undefined,
        }),
      },
    });
    const requestedCrib = DataFactory.createMockPatient('R1', {
      bedMode: 'Cuna',
      patientName: 'RN solicitado',
      clinicalEpisodeId: 'requested-crib',
      rut: '',
    });
    const concurrentCrib = DataFactory.createMockPatient('R1', {
      bedMode: 'Cuna',
      patientName: 'RN creado en otra pestaña',
      clinicalEpisodeId: 'concurrent-crib',
      rut: '',
    });
    const authoritativeRecord = DataFactory.createMockDailyRecord(mockDate, {
      ...occupiedRecord,
      lastUpdated: '2026-01-01T00:00:02.000Z',
      beds: {
        R1: { ...occupiedRecord.beds.R1, clinicalCrib: concurrentCrib },
      },
    });
    vi.mocked(defaultDailyRecordRepositoryPort.getForDateWithMeta).mockResolvedValue(
      buildReadResult(occupiedRecord)
    );
    vi.mocked(defaultDailyRecordRepositoryPort.getAuthoritativeForDate).mockResolvedValue(
      authoritativeRecord
    );

    const { result } = renderHook(() => useDailyRecordSyncQuery(mockDate, false, 'ready'), {
      wrapper: createWrapper(),
    });
    await waitFor(() =>
      expect(result.current.record?.beds.R1.patientName).toBe('Paciente principal')
    );

    let createPromise!: Promise<void>;
    act(() => {
      createPromise = result.current.patchRecord(
        { 'beds.R1.clinicalCrib': requestedCrib },
        buildClinicalCribCreateOptions(occupiedRecord)
      );
    });

    await expect(createPromise).rejects.toThrow('La cama o su cuna cambiaron');
    await waitFor(() =>
      expect(result.current.record?.beds.R1.clinicalCrib?.clinicalEpisodeId).toBe('concurrent-crib')
    );
    expect(defaultDailyRecordRepositoryPort.updatePartialDetailed).not.toHaveBeenCalled();
  });

  it('refreshes the parent-derived crib name after a safe authoritative rebase', async () => {
    const occupiedRecord = DataFactory.createMockDailyRecord(mockDate, {
      ...mockRecord,
      beds: {
        R1: DataFactory.createMockPatient('R1', {
          patientName: 'Nombre anterior',
          clinicalEpisodeId: 'parent-episode',
          clinicalCrib: undefined,
        }),
      },
    });
    const requestedCrib = DataFactory.createMockPatient('R1', {
      bedMode: 'Cuna',
      patientName: 'RN de Nombre anterior',
      clinicalEpisodeId: 'requested-crib',
      rut: '',
    });
    const authoritativeRecord = DataFactory.createMockDailyRecord(mockDate, {
      ...occupiedRecord,
      lastUpdated: '2026-01-01T00:00:02.000Z',
      beds: {
        R1: { ...occupiedRecord.beds.R1, patientName: 'Nombre corregido' },
      },
    });
    const confirmedRecord = {
      ...authoritativeRecord,
      beds: {
        R1: {
          ...authoritativeRecord.beds.R1,
          clinicalCrib: { ...requestedCrib, patientName: 'RN de Nombre corregido' },
        },
      },
      lastUpdated: '2026-01-01T00:00:03.000Z',
    };
    vi.mocked(defaultDailyRecordRepositoryPort.getForDateWithMeta).mockResolvedValue(
      buildReadResult(occupiedRecord)
    );
    vi.mocked(defaultDailyRecordRepositoryPort.getAuthoritativeForDate).mockResolvedValue(
      authoritativeRecord
    );
    vi.mocked(defaultDailyRecordRepositoryPort.updatePartialDetailed).mockResolvedValue(
      createUpdatePartialDailyRecordResult({
        date: mockDate,
        outcome: 'clean',
        savedLocally: true,
        updatedRemotely: true,
        queuedForRetry: false,
        autoMerged: false,
        patchedFields: 1,
        confirmedRecord,
      })
    );

    const { result } = renderHook(() => useDailyRecordSyncQuery(mockDate, false, 'ready'), {
      wrapper: createWrapper(),
    });
    await waitFor(() => expect(result.current.record?.beds.R1).toBeDefined());

    await act(async () => {
      await result.current.patchRecord(
        { 'beds.R1.clinicalCrib': requestedCrib },
        buildClinicalCribCreateOptions(occupiedRecord)
      );
    });

    expect(defaultDailyRecordRepositoryPort.updatePartialDetailed).toHaveBeenCalledWith(
      mockDate,
      {
        'beds.R1.clinicalCrib': expect.objectContaining({
          patientName: 'RN de Nombre corregido',
          clinicalEpisodeId: 'requested-crib',
        }),
      },
      expect.objectContaining({ baseRecord: authoritativeRecord })
    );
  });

  it('hides a clinical crib immediately and restores it on remote rejection', async () => {
    const crib = DataFactory.createMockPatient('R1', {
      bedMode: 'Cuna',
      patientName: 'RN protegido',
      rut: '22.222.222-2',
    });
    const occupiedRecord = DataFactory.createMockDailyRecord(mockDate, {
      ...mockRecord,
      beds: {
        R1: DataFactory.createMockPatient('R1', {
          patientName: 'Paciente principal',
          clinicalCrib: crib,
        }),
      },
    });
    const write = createDeferred<ReturnType<typeof createUpdatePartialDailyRecordResult>>();
    vi.mocked(defaultDailyRecordRepositoryPort.getForDateWithMeta).mockResolvedValue(
      buildReadResult(occupiedRecord)
    );
    vi.mocked(defaultDailyRecordRepositoryPort.updatePartialDetailed).mockImplementation(
      () => write.promise
    );

    const { result } = renderHook(() => useDailyRecordSyncQuery(mockDate, false, 'ready'), {
      wrapper: createWrapper(),
    });
    await waitFor(() => {
      expect(result.current.record?.beds.R1.clinicalCrib?.patientName).toBe('RN protegido');
    });

    let clearPromise!: Promise<void>;
    act(() => {
      clearPromise = result.current.patchRecord(
        { 'beds.R1.clinicalCrib': null },
        {
          consistency: 'remote_confirmed',
          optimisticRemoteConfirmed: true,
          intentionalBedClear: {
            bedId: 'R1',
            target: 'clinicalCrib',
            confirmedLastUpdated: occupiedRecord.lastUpdated,
            confirmedOccupant: {
              patientName: crib.patientName,
              rut: crib.rut,
              admissionDate: crib.admissionDate,
            },
          },
        }
      );
    });

    await waitFor(() => {
      expect(result.current.record?.beds.R1.clinicalCrib).toBeFalsy();
    });

    write.reject(new Error('remote unavailable'));
    await expect(clearPromise).rejects.toThrow('remote unavailable');
    await waitFor(() => {
      expect(result.current.record?.beds.R1.clinicalCrib?.patientName).toBe('RN protegido');
    });
  });
});
