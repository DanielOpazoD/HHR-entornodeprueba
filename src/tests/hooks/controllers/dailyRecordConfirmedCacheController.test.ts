import { afterEach, describe, expect, it, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { DataFactory } from '@/tests/factories/DataFactory';
import { PatientStatus } from '@/types/domain/patientClassification';
import type { DailyRecord } from '@/application/shared/dailyRecordCoreContracts';
import type { DailyRecordQueryResult } from '@/services/repositories/contracts/dailyRecordQueries';
import {
  createDailyRecordSubscription,
  getDailyRecordQueryKey,
  setDailyRecordQueryData,
} from '@/hooks/controllers/dailyRecordQueryController';
import {
  setAcknowledgedDailyRecordQueryData,
  setRemoteConfirmedDailyRecordQueryData,
} from '@/hooks/controllers/dailyRecordConfirmedCacheController';
import {
  clearPendingDailyRecordPatchesForTests,
  registerPendingDailyRecordPatch,
} from '@/hooks/controllers/dailyRecordPendingPatchController';

vi.mock('@/services/repositories/dailyRecordOperationalTelemetry', () => ({
  dailyRecordObservability: {
    recordEvent: vi.fn(),
    recordError: vi.fn(),
  },
}));

describe('dailyRecordConfirmedCacheController', () => {
  afterEach(() => {
    clearPendingDailyRecordPatchesForTests();
  });

  it('does not let a delayed realtime snapshot erase a server-confirmed sync attempt', async () => {
    const date = '2025-01-08';
    const queryClient = new QueryClient();
    const failedAttempt = {
      id: 'run-before',
      sourceDate: date,
      startedAt: '2025-01-08T10:00:00.000Z',
      completedAt: '2025-01-08T10:00:05.000Z',
      by: 'Enfermera Demo',
      status: 'failed' as const,
    };
    const appliedAttempt = {
      id: 'run-current',
      sourceDate: date,
      startedAt: '2025-01-08T10:10:00.000Z',
      completedAt: '2025-01-08T10:10:10.000Z',
      by: 'Enfermera Demo',
      status: 'applied' as const,
    };
    const staleRecord = {
      ...DataFactory.createMockDailyRecord(date),
      lastUpdated: '2025-01-08T10:00:05.000Z',
      rayenSyncHistory: [failedAttempt],
    };
    const confirmedRecord = {
      ...staleRecord,
      lastUpdated: '2025-01-08T10:10:10.000Z',
      rayenSyncHistory: [appliedAttempt, failedAttempt],
    };

    await setRemoteConfirmedDailyRecordQueryData(queryClient, date, confirmedRecord);
    const subscribeDetailed = vi.fn((_date, callback) => {
      callback(
        {
          date,
          outcome: 'clean',
          record: staleRecord,
          consistencyState: 'remote_applied',
          sourceOfTruth: 'remote',
          retryability: 'not_applicable',
          recoveryAction: 'none',
          conflictSummary: null,
          observabilityTags: ['daily_record', 'sync'],
          repairApplied: false,
        },
        false
      );
      return vi.fn();
    });

    createDailyRecordSubscription({ getForDate: vi.fn(), subscribeDetailed }, date, queryClient);

    expect(
      queryClient.getQueryData<{
        record: DailyRecord;
      }>(getDailyRecordQueryKey(date))?.record.rayenSyncHistory
    ).toEqual([appliedAttempt, failedAttempt]);
  });

  it('does not replace newer remote clinical data with an older confirmed write response', async () => {
    const date = '2025-01-08';
    const queryClient = new QueryClient();
    const olderConfirmation = {
      ...DataFactory.createMockDailyRecord(date),
      lastUpdated: '2025-01-08T10:10:00.000Z',
    };
    const newerRemoteRecord = {
      ...olderConfirmation,
      lastUpdated: '2025-01-08T10:10:05.000Z',
      beds: {
        ...olderConfirmation.beds,
        R1: {
          ...olderConfirmation.beds.R1,
          medicalHandoffNote: 'Dato clínico remoto más reciente',
        },
      },
    };

    await setRemoteConfirmedDailyRecordQueryData(queryClient, date, newerRemoteRecord);
    await setRemoteConfirmedDailyRecordQueryData(queryClient, date, olderConfirmation);

    expect(
      queryClient.getQueryData<DailyRecordQueryResult>(getDailyRecordQueryKey(date))
    ).toMatchObject({
      record: newerRemoteRecord,
      runtime: { sourceOfTruth: 'remote' },
    });
  });

  it('preserves a newer local outbox projection over an older confirmed write response', async () => {
    const date = '2025-01-08';
    const queryClient = new QueryClient();
    const confirmedRecord = {
      ...DataFactory.createMockDailyRecord(date),
      lastUpdated: '2025-01-08T10:10:00.000Z',
    };
    const pendingLocalRecord = {
      ...confirmedRecord,
      lastUpdated: '2025-01-08T10:10:05.000Z',
      beds: {
        ...confirmedRecord.beds,
        R1: {
          ...confirmedRecord.beds.R1,
          medicalHandoffNote: 'Proyección local pendiente',
        },
      },
    };

    setDailyRecordQueryData(queryClient, date, pendingLocalRecord);
    await setRemoteConfirmedDailyRecordQueryData(queryClient, date, confirmedRecord);

    expect(
      queryClient.getQueryData<DailyRecordQueryResult>(getDailyRecordQueryKey(date))
    ).toMatchObject({
      record: pendingLocalRecord,
      runtime: { sourceOfTruth: 'local' },
    });
  });

  it('releases an acknowledged patch before preserving a newer pending projection', async () => {
    const date = '2025-01-08';
    const queryClient = new QueryClient();
    const baseRecord = DataFactory.createMockDailyRecord(date);
    baseRecord.lastUpdated = '2025-01-08T10:00:00.000Z';
    baseRecord.beds.R1.clinicalEpisodeId = 'ep-r1';
    baseRecord.beds.R1.rut = '11.111.111-1';
    baseRecord.beds.R1.admissionDate = date;
    baseRecord.beds.R1.specialty = 'Base';
    baseRecord.beds.R1.status = PatientStatus.ESTABLE;
    registerPendingDailyRecordPatch(date, { 'beds.R1.specialty': 'Confirmada' });
    registerPendingDailyRecordPatch(date, { 'beds.R1.status': PatientStatus.DE_CUIDADO });
    const newerPendingProjection = {
      ...baseRecord,
      lastUpdated: '2025-01-08T10:20:00.000Z',
      beds: {
        ...baseRecord.beds,
        R1: {
          ...baseRecord.beds.R1,
          specialty: 'Confirmada',
          status: PatientStatus.DE_CUIDADO,
        },
      },
    };
    const confirmedFirstPatch = {
      ...baseRecord,
      lastUpdated: '2025-01-08T10:10:00.000Z',
      beds: {
        ...baseRecord.beds,
        R1: { ...baseRecord.beds.R1, specialty: 'Confirmada' },
      },
    };
    setDailyRecordQueryData(queryClient, date, newerPendingProjection);

    await setRemoteConfirmedDailyRecordQueryData(queryClient, date, confirmedFirstPatch);

    const laterRemoteRecord = {
      ...confirmedFirstPatch,
      lastUpdated: '2025-01-08T10:30:00.000Z',
      beds: {
        ...confirmedFirstPatch.beds,
        R1: {
          ...confirmedFirstPatch.beds.R1,
          specialty: 'Cambio remoto posterior',
          status: PatientStatus.ESTABLE,
        },
      },
    };
    createDailyRecordSubscription(
      {
        getForDate: vi.fn(),
        subscribe: vi.fn((_date, callback) => {
          callback(laterRemoteRecord, false);
          return vi.fn();
        }),
      },
      date,
      queryClient
    );

    expect(
      queryClient.getQueryData<DailyRecordQueryResult>(getDailyRecordQueryKey(date))?.record?.beds
        .R1
    ).toMatchObject({
      specialty: 'Cambio remoto posterior',
      status: PatientStatus.DE_CUIDADO,
    });
  });

  it('keeps remote runtime when an older acknowledgement settles after newer remote data', async () => {
    const date = '2025-01-08';
    const queryClient = new QueryClient();
    const oldConfirmation = {
      ...DataFactory.createMockDailyRecord(date),
      lastUpdated: '2025-01-08T10:10:00.000Z',
    };
    const newerRemoteRecord = {
      ...oldConfirmation,
      lastUpdated: '2025-01-08T10:30:00.000Z',
      beds: {
        ...oldConfirmation.beds,
        R1: { ...oldConfirmation.beds.R1, specialty: 'Remota nueva' },
      },
    };
    await setRemoteConfirmedDailyRecordQueryData(queryClient, date, newerRemoteRecord);

    await setAcknowledgedDailyRecordQueryData(
      queryClient,
      date,
      newerRemoteRecord,
      oldConfirmation
    );

    const intermediateRemoteRecord = {
      ...oldConfirmation,
      lastUpdated: '2025-01-08T10:20:00.000Z',
      beds: {
        ...oldConfirmation.beds,
        R1: { ...oldConfirmation.beds.R1, specialty: 'Remota intermedia' },
      },
    };
    createDailyRecordSubscription(
      {
        getForDate: vi.fn(),
        subscribe: vi.fn((_date, callback) => {
          callback(intermediateRemoteRecord, false);
          return vi.fn();
        }),
      },
      date,
      queryClient
    );

    expect(
      queryClient.getQueryData<DailyRecordQueryResult>(getDailyRecordQueryKey(date))
    ).toMatchObject({
      record: newerRemoteRecord,
      runtime: { sourceOfTruth: 'remote' },
    });
  });

  it('replaces the acknowledged mutation own optimistic projection', async () => {
    const date = '2025-01-08';
    const queryClient = new QueryClient();
    const confirmedRecord = {
      ...DataFactory.createMockDailyRecord(date),
      lastUpdated: '2025-01-08T10:10:00.000Z',
    };
    const ownOptimisticRecord = {
      ...confirmedRecord,
      lastUpdated: '2025-01-08T10:10:05.000Z',
    };

    setDailyRecordQueryData(queryClient, date, ownOptimisticRecord);
    await setRemoteConfirmedDailyRecordQueryData(queryClient, date, confirmedRecord, {
      replaceOptimisticLastUpdated: ownOptimisticRecord.lastUpdated,
    });

    expect(
      queryClient.getQueryData<DailyRecordQueryResult>(getDailyRecordQueryKey(date))
    ).toMatchObject({
      record: confirmedRecord,
      runtime: { sourceOfTruth: 'remote' },
    });
  });

  it('publishes an equivalent local projection clone as the confirmed remote record', async () => {
    const date = '2025-01-08';
    const queryClient = new QueryClient();
    const confirmedRecord = {
      ...DataFactory.createMockDailyRecord(date),
      lastUpdated: '2025-01-08T10:10:00.000Z',
      rayenSyncHistory: [
        {
          id: 'run-current',
          sourceDate: date,
          startedAt: '2025-01-08T10:09:00.000Z',
          completedAt: '2025-01-08T10:10:00.000Z',
          by: 'Enfermera Demo',
          status: 'partial' as const,
        },
      ],
    };
    const localProjectionClone = structuredClone(confirmedRecord);

    await setAcknowledgedDailyRecordQueryData(
      queryClient,
      date,
      localProjectionClone,
      confirmedRecord
    );

    expect(
      queryClient.getQueryData<DailyRecordQueryResult>(getDailyRecordQueryKey(date))
    ).toMatchObject({
      record: confirmedRecord,
      runtime: { sourceOfTruth: 'remote', consistencyState: 'remote_authoritative' },
    });
  });

  it('cancels an older in-flight refetch before publishing a confirmed sync attempt', async () => {
    const date = '2025-01-08';
    const queryClient = new QueryClient();
    const staleRecord = {
      ...DataFactory.createMockDailyRecord(date),
      lastUpdated: '2025-01-08T10:00:00.000Z',
      rayenSyncHistory: [],
    };
    const confirmedRecord = {
      ...staleRecord,
      lastUpdated: '2025-01-08T10:10:00.000Z',
      rayenSyncHistory: [
        {
          id: 'run-current',
          sourceDate: date,
          startedAt: '2025-01-08T10:09:00.000Z',
          completedAt: '2025-01-08T10:10:00.000Z',
          by: 'Enfermera Demo',
          status: 'applied' as const,
        },
      ],
    };
    let resolveStaleRead!: (record: DailyRecord) => void;
    const staleRead = new Promise<DailyRecord>(resolve => {
      resolveStaleRead = resolve;
    });
    const refetch = queryClient.fetchQuery({
      queryKey: getDailyRecordQueryKey(date),
      queryFn: async () => ({
        record: await staleRead,
        runtime: {
          date,
          availabilityState: 'resolved' as const,
          consistencyState: 'remote_authoritative' as const,
          sourceOfTruth: 'remote' as const,
          retryability: 'not_applicable' as const,
          recoveryAction: 'none' as const,
          conflictSummary: null,
          observabilityTags: ['daily_record', 'read'],
          repairApplied: false,
        },
      }),
    });

    await setRemoteConfirmedDailyRecordQueryData(queryClient, date, confirmedRecord);
    resolveStaleRead(staleRecord);
    await refetch.catch(() => undefined);

    expect(
      queryClient.getQueryData<DailyRecordQueryResult>(getDailyRecordQueryKey(date))?.record
        ?.rayenSyncHistory
    ).toEqual(confirmedRecord.rayenSyncHistory);
  });

  it('keeps manual newer cache data when cancelling a refetch with default TanStack semantics', async () => {
    const date = '2025-01-08';
    const queryClient = new QueryClient();
    const initialRecord = {
      ...DataFactory.createMockDailyRecord(date),
      lastUpdated: '2025-01-08T10:00:00.000Z',
    };
    const newerRecord = {
      ...initialRecord,
      lastUpdated: '2025-01-08T10:30:00.000Z',
      beds: {
        ...initialRecord.beds,
        R1: { ...initialRecord.beds.R1, specialty: 'Remota nueva' },
      },
    };
    await setRemoteConfirmedDailyRecordQueryData(queryClient, date, initialRecord);
    let resolveRead!: (value: DailyRecordQueryResult) => void;
    const pendingRead = new Promise<DailyRecordQueryResult>(resolve => {
      resolveRead = resolve;
    });
    const refetch = queryClient.fetchQuery({
      queryKey: getDailyRecordQueryKey(date),
      queryFn: () => pendingRead,
    });
    queryClient.setQueryData<DailyRecordQueryResult>(getDailyRecordQueryKey(date), previous => ({
      ...previous!,
      record: newerRecord,
    }));

    await setRemoteConfirmedDailyRecordQueryData(queryClient, date, initialRecord);
    resolveRead(queryClient.getQueryData<DailyRecordQueryResult>(getDailyRecordQueryKey(date))!);
    await refetch.catch(() => undefined);

    expect(
      queryClient.getQueryData<DailyRecordQueryResult>(getDailyRecordQueryKey(date))
    ).toMatchObject({
      record: newerRecord,
      runtime: { sourceOfTruth: 'remote' },
    });
  });

  it('does not overwrite newer realtime data published while cancellation is pending', async () => {
    const date = '2025-01-08';
    const queryClient = new QueryClient();
    const confirmedRecord = {
      ...DataFactory.createMockDailyRecord(date),
      lastUpdated: '2025-01-08T10:10:00.000Z',
    };
    const capturedProjection = {
      ...confirmedRecord,
      lastUpdated: '2025-01-08T10:20:00.000Z',
      beds: {
        ...confirmedRecord.beds,
        R1: { ...confirmedRecord.beds.R1, specialty: 'Proyección capturada' },
      },
    };
    const newerRealtimeRecord = {
      ...capturedProjection,
      lastUpdated: '2025-01-08T10:30:00.000Z',
      beds: {
        ...capturedProjection.beds,
        R1: { ...capturedProjection.beds.R1, specialty: 'Realtime más reciente' },
      },
    };
    vi.spyOn(queryClient, 'cancelQueries').mockImplementation(async () => {
      await Promise.resolve();
      queryClient.setQueryData<DailyRecordQueryResult>(getDailyRecordQueryKey(date), {
        record: newerRealtimeRecord,
        runtime: {
          date,
          availabilityState: 'resolved',
          consistencyState: 'remote_authoritative',
          sourceOfTruth: 'remote',
          retryability: 'not_applicable',
          recoveryAction: 'none',
          conflictSummary: null,
          observabilityTags: ['daily_record', 'sync'],
          repairApplied: false,
        },
      });
    });

    await setAcknowledgedDailyRecordQueryData(
      queryClient,
      date,
      capturedProjection,
      confirmedRecord
    );

    expect(
      queryClient.getQueryData<DailyRecordQueryResult>(getDailyRecordQueryKey(date))
    ).toMatchObject({
      record: newerRealtimeRecord,
      runtime: { sourceOfTruth: 'remote' },
    });
  });
});
