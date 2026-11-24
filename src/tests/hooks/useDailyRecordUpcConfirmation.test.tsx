import { executeBedManagementAction } from '@/hooks/controllers/bedManagementDispatchController';
import { buildUpcCriteriaEvaluation } from '@/domain/upc/upcCriteriaEvaluation';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, screen, waitFor } from '@testing-library/react';
import { UIProvider } from '@/context/UIContext';
import { useDailyRecordSyncQuery } from '@/hooks/useDailyRecordSyncQuery';
import { createQueryClientTestWrapper } from '@/tests/utils/queryClientTestUtils';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import { DataFactory } from '@/tests/factories/DataFactory';
import type { DailyRecordWriteResult } from '@/services/repositories/contracts/dailyRecordResults';

const { mockDailyRecordRepositoryPort } = vi.hoisted(() => ({
  mockDailyRecordRepositoryPort: {
    getForDate: vi.fn(),
    getForDateWithMeta: vi.fn(),
    getAuthoritativeForDate: vi.fn(),
    adoptAuthoritativeRecord: vi.fn(async record => record),
    save: vi.fn(),
    saveDetailed: vi.fn(),
    subscribeDetailed: vi.fn(() => vi.fn()),
    updatePartial: vi.fn(),
    updatePartialDetailed: vi.fn(),
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
  defaultDailyRecordRepositoryPort: mockDailyRecordRepositoryPort,
}));

vi.mock('@/context/RepositoryContext', async importOriginal => ({
  ...(await importOriginal<typeof import('@/context/RepositoryContext')>()),
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

describe('remote-confirmed UPC journal', () => {
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

  it('passes explicit atomic CAS for a signed UPC journal without an optimistic update', async () => {
    const occupied = DataFactory.createMockDailyRecord(mockDate, {
      ...mockRecord,
      beds: { R1: DataFactory.createMockPatient('R1', { patientName: 'Paciente de prueba' }) },
    });
    const checklist = {
      uciCriteria: [],
      utiCriteria: [],
      classification: null,
      evaluatedAt: '2025-12-27T12:00:00Z',
      history: [],
    };
    const write = createDeferred<DailyRecordWriteResult>();
    mockDailyRecordRepositoryPort.getForDateWithMeta.mockResolvedValue(buildReadResult(occupied));
    mockDailyRecordRepositoryPort.updatePartialDetailed.mockImplementation(() => write.promise);
    const { result } = renderHook(() => useDailyRecordSyncQuery(mockDate, 'ready'), {
      wrapper: createWrapper(),
    });
    await waitFor(() => expect(result.current.record?.beds.R1).toBeDefined());
    let saving!: Promise<void>;
    act(() => {
      saving = result.current.patchRecord(
        { 'beds.R1.upcChecklist': checklist },
        { consistency: 'remote_confirmed', requireAtomicCas: true }
      );
    });
    await waitFor(() =>
      expect(mockDailyRecordRepositoryPort.updatePartialDetailed).toHaveBeenCalledWith(
        mockDate,
        { 'beds.R1.upcChecklist': checklist },
        expect.objectContaining({
          requireAtomicCas: true,
          requireRemoteAuthorityFirst: true,
          requireConfirmedRecord: true,
        })
      )
    );
    expect(result.current.record?.beds.R1.upcChecklist).toBeUndefined();
    write.reject(new Error('UPC journal changed remotely'));
    await expect(saving).rejects.toThrow('UPC journal changed remotely');
    expect(result.current.record?.beds.R1.upcChecklist).toBeUndefined();
  });
  it('confirms four signed evaluations with one repository write and one final notice', async () => {
    const bedIds = ['R1', 'R2', 'NEO1', 'NEO2'];
    const beds = Object.fromEntries(
      bedIds.map(bedId => [
        bedId,
        DataFactory.createMockPatient(bedId, {
          patientName: `Paciente de prueba ${bedId}`,
          clinicalEpisodeId: `ep_${bedId}`,
        }),
      ])
    );
    const occupied = DataFactory.createMockDailyRecord(mockDate, { ...mockRecord, beds });
    const write = createDeferred<DailyRecordWriteResult>();
    mockDailyRecordRepositoryPort.getForDateWithMeta.mockResolvedValue(buildReadResult(occupied));
    mockDailyRecordRepositoryPort.updatePartialDetailed.mockReturnValue(write.promise);
    const { result } = renderHook(() => useDailyRecordSyncQuery(mockDate, 'ready'), {
      wrapper: createWrapper(),
    });
    await waitFor(() => expect(result.current.record?.beds.R1).toBeDefined());
    const evaluations = bedIds.map(bedId => ({
      bedId,
      isCrib: false,
      episodeIdentity: `ep_${bedId}`,
      record: buildUpcCriteriaEvaluation({
        actor: { uid: 'nurse-test', displayName: 'Profesional de prueba' },
        date: mockDate,
        bedId,
        evaluationId: `evaluation-${bedId}`,
        evaluatedAt: '2025-12-27T12:00:00Z',
        uciCriteria: [],
        utiCriteria: [],
      }),
    }));
    const staleDayGuard = vi.fn().mockResolvedValue(true);
    let saving!: Promise<boolean>;
    act(() => {
      saving = executeBedManagementAction({
        action: { type: 'CONFIRM_UPC_ROUND', evaluations },
        currentRecord: occupied,
        patchRecord: result.current.patchRecord,
        ensureStaleDayEditAllowed: staleDayGuard,
        validation: { processFieldValue: vi.fn() },
        bedAudit: {
          auditPatientChange: vi.fn(),
          auditPatientCleared: vi.fn(),
          auditPatientModified: vi.fn(),
          auditPatientMovement: vi.fn(),
        },
      });
    });
    await waitFor(() =>
      expect(mockDailyRecordRepositoryPort.updatePartialDetailed).toHaveBeenCalledTimes(1)
    );
    const [, patch, options] = mockDailyRecordRepositoryPort.updatePartialDetailed.mock.calls[0];
    expect(Object.keys(patch).filter(key => key.endsWith('.upcChecklist'))).toHaveLength(4);
    expect(options).toMatchObject({
      baseRecord: occupied,
      requireAtomicCas: true,
      requireRemoteAuthorityFirst: true,
    });
    expect(staleDayGuard).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Cambio guardado')).toBeNull();
    const confirmedRecord = {
      ...occupied,
      beds: Object.fromEntries(
        evaluations.map(entry => [
          entry.bedId,
          { ...beds[entry.bedId], upcChecklist: entry.record },
        ])
      ),
    };
    await act(async () => {
      write.resolve({
        date: mockDate,
        state: 'confirmed',
        savedHere: true,
        localCopy: 'current',
        confirmedRecord,
      });
      expect(await saving).toBe(true);
    });
    expect(await screen.findAllByText('Cambio guardado')).toHaveLength(1);
    expect(mockDailyRecordRepositoryPort.updatePartialDetailed).toHaveBeenCalledTimes(1);
  });
});
