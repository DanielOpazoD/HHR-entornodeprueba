import { afterEach, describe, expect, it, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { DataFactory } from '@/tests/factories/DataFactory';
import { setFirestoreSyncState } from '@/services/repositories/repositoryConfig';
import { PatientStatus } from '@/types/domain/patientClassification';
import type { DailyRecord } from '@/application/shared/dailyRecordCoreContracts';
import {
  applyOptimisticDailyRecordPatch,
  buildPreviousDayDate,
  createDailyRecordQueryFn,
  createDailyRecordSubscription,
  getDailyRecordQueryKey,
  invalidateDailyRecordQuery,
  setDailyRecordQueryData,
  shouldUseDailyRecordRealtimeSync,
} from '@/hooks/controllers/dailyRecordQueryController';
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

describe('dailyRecordQueryController', () => {
  afterEach(() => {
    clearPendingDailyRecordPatchesForTests();
  });

  it('keeps realtime sync disabled while Firestore runtime is bootstrapping', () => {
    setFirestoreSyncState({
      mode: 'bootstrapping',
      reason: 'auth_loading',
    });

    expect(shouldUseDailyRecordRealtimeSync('2025-01-08', false, 'ready')).toBe(false);

    setFirestoreSyncState({
      mode: 'enabled',
      reason: 'ready',
    });
  });

  it('builds query functions and cache keys consistently', async () => {
    const record = DataFactory.createMockDailyRecord('2025-01-08');
    const repository = { getForDate: vi.fn().mockResolvedValue(record) };

    await expect(createDailyRecordQueryFn(repository, '2025-01-08')()).resolves.toMatchObject({
      record,
      runtime: {
        availabilityState: 'resolved',
        consistencyState: 'local_only',
      },
    });
    expect(repository.getForDate).toHaveBeenCalledWith('2025-01-08');
    expect(getDailyRecordQueryKey('2025-01-08')).toEqual(['dailyRecord', '2025-01-08']);
  });

  it('builds query functions without forcing remote sync before the runtime is ready', async () => {
    const record = DataFactory.createMockDailyRecord('2025-01-08');
    const repository = {
      getForDate: vi.fn(),
      getForDateWithMeta: vi.fn().mockResolvedValue({
        date: '2025-01-08',
        record,
        source: 'indexeddb',
        compatibilityTier: 'none',
        compatibilityIntensity: 'none',
        migrationRulesApplied: [],
        consistencyState: 'local_only',
        sourceOfTruth: 'local',
        retryability: 'not_applicable',
        recoveryAction: 'none',
        conflictSummary: null,
        observabilityTags: ['daily_record', 'read'],
        repairApplied: false,
      }),
    };

    await expect(
      createDailyRecordQueryFn(repository, '2025-01-08', false)()
    ).resolves.toMatchObject({
      record,
      runtime: {
        sourceOfTruth: 'local',
      },
    });
    expect(repository.getForDateWithMeta).toHaveBeenCalledWith('2025-01-08', false);
  });

  it('applies optimistic patches and stamps lastUpdated', () => {
    const previous = DataFactory.createMockDailyRecord('2025-01-08');
    const updated = applyOptimisticDailyRecordPatch(previous, {
      'beds.R1.patientName': 'Paciente Demo',
    });

    expect(updated.beds.R1.patientName).toBe('Paciente Demo');
    expect(updated.lastUpdated).not.toBe(previous.lastUpdated);
  });

  it('creates subscriptions that ignore local echoes', () => {
    const queryClient = new QueryClient();
    const record = DataFactory.createMockDailyRecord('2025-01-08');
    const subscribe = vi.fn((_date, callback) => {
      callback(record, true);
      callback(record, false);
      return vi.fn();
    });

    const unsubscribe = createDailyRecordSubscription(
      { getForDate: vi.fn(), subscribe },
      '2025-01-08',
      queryClient
    );

    expect(unsubscribe).toBeTypeOf('function');
    expect(queryClient.getQueryData(getDailyRecordQueryKey('2025-01-08'))).toMatchObject({
      record,
      runtime: {
        availabilityState: 'resolved',
      },
    });
  });

  it('reconciles null realtime payloads against the repository before clearing cache', async () => {
    const queryClient = new QueryClient();
    const previousRecord = DataFactory.createMockDailyRecord('2025-01-08');
    const recoveredRecord = {
      ...previousRecord,
      lastUpdated: '2025-01-08T10:10:00.000Z',
    };
    queryClient.setQueryData(getDailyRecordQueryKey('2025-01-08'), {
      record: previousRecord,
      runtime: {
        date: '2025-01-08',
        availabilityState: 'resolved',
        consistencyState: 'local_only',
        sourceOfTruth: 'local',
        retryability: 'not_applicable',
        recoveryAction: 'none',
        conflictSummary: null,
        observabilityTags: ['daily_record', 'read'],
        repairApplied: false,
      },
    });

    const subscribe = vi.fn((_date, callback) => {
      void callback(null, false);
      return vi.fn();
    });

    const unsubscribe = createDailyRecordSubscription(
      { getForDate: vi.fn().mockResolvedValue(recoveredRecord), subscribe },
      '2025-01-08',
      queryClient
    );

    await Promise.resolve();
    await Promise.resolve();

    expect(unsubscribe).toBeTypeOf('function');
    expect(queryClient.getQueryData(getDailyRecordQueryKey('2025-01-08'))).toMatchObject({
      record: recoveredRecord,
      runtime: {
        availabilityState: 'recoverable_local',
      },
    });
  });

  it('preserves a newer cached record when realtime emits an older snapshot', () => {
    const queryClient = new QueryClient();
    const previousRecord = {
      ...DataFactory.createMockDailyRecord('2025-01-08'),
      lastUpdated: '2025-01-08T12:00:00.000Z',
      beds: {
        ...DataFactory.createMockDailyRecord('2025-01-08').beds,
        R1: {
          ...DataFactory.createMockDailyRecord('2025-01-08').beds.R1,
          medicalHandoffNote: 'Nota nueva',
        },
      },
    };
    const staleRealtimeRecord = {
      ...previousRecord,
      lastUpdated: '2025-01-08T11:59:58.000Z',
      beds: {
        ...previousRecord.beds,
        R1: {
          ...previousRecord.beds.R1,
          medicalHandoffNote: 'Nota vieja',
        },
      },
    };

    queryClient.setQueryData(getDailyRecordQueryKey('2025-01-08'), {
      record: previousRecord,
      runtime: {
        date: '2025-01-08',
        availabilityState: 'resolved',
        consistencyState: 'local_only',
        sourceOfTruth: 'local',
        retryability: 'not_applicable',
        recoveryAction: 'none',
        conflictSummary: null,
        observabilityTags: ['daily_record', 'read'],
        repairApplied: false,
      },
    });

    const subscribe = vi.fn((_date, callback) => {
      callback(staleRealtimeRecord, false);
      return vi.fn();
    });

    createDailyRecordSubscription({ getForDate: vi.fn(), subscribe }, '2025-01-08', queryClient);

    expect(queryClient.getQueryData(getDailyRecordQueryKey('2025-01-08'))).toMatchObject({
      record: previousRecord,
    });
  });

  it('accepts a confirmed remote snapshot over a newer local optimistic cache', () => {
    const queryClient = new QueryClient();
    const previousRecord = DataFactory.createMockDailyRecord('2025-01-08');
    previousRecord.lastUpdated = '2025-01-08T12:00:10.000Z';
    previousRecord.beds.R1.specialty = 'Otra especialidad local optimista';
    previousRecord.beds.R1.secondarySpecialty = 'Texto local aun no confirmado';
    previousRecord.beds.R1.status = PatientStatus.DE_CUIDADO;

    const remoteRecord = DataFactory.createMockDailyRecord('2025-01-08');
    remoteRecord.lastUpdated = '2025-01-08T12:00:05.000Z';
    remoteRecord.beds.R1.specialty = 'Medicina';
    remoteRecord.beds.R1.secondarySpecialty = '';
    remoteRecord.beds.R1.status = PatientStatus.ESTABLE;

    queryClient.setQueryData(getDailyRecordQueryKey('2025-01-08'), {
      record: previousRecord,
      runtime: {
        date: '2025-01-08',
        availabilityState: 'resolved',
        consistencyState: 'local_only',
        sourceOfTruth: 'local',
        retryability: 'not_applicable',
        recoveryAction: 'none',
        conflictSummary: null,
        observabilityTags: ['daily_record', 'read'],
        repairApplied: false,
      },
    });

    const subscribeDetailed = vi.fn((_date, callback) => {
      callback(
        {
          date: '2025-01-08',
          outcome: 'clean',
          record: remoteRecord,
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

    createDailyRecordSubscription(
      { getForDate: vi.fn(), subscribeDetailed },
      '2025-01-08',
      queryClient
    );

    expect(queryClient.getQueryData(getDailyRecordQueryKey('2025-01-08'))).toMatchObject({
      record: {
        beds: {
          R1: expect.objectContaining({
            specialty: 'Medicina',
            secondarySpecialty: '',
            status: PatientStatus.ESTABLE,
          }),
        },
      },
      runtime: {
        sourceOfTruth: 'remote',
      },
    });
  });

  it('keeps pending local diagnosis, specialty and status edits visible over a newer realtime snapshot for the same episode', () => {
    clearPendingDailyRecordPatchesForTests();
    const queryClient = new QueryClient();
    const previousRecord = DataFactory.createMockDailyRecord('2025-01-08');
    previousRecord.lastUpdated = '2025-01-08T12:00:00.000Z';
    previousRecord.beds.R1.clinicalEpisodeId = 'ep-r1';
    previousRecord.beds.R1.rut = '11.111.111-1';
    previousRecord.beds.R1.admissionDate = '2025-01-08';
    previousRecord.beds.R1.specialty = 'Otorrino libre';
    previousRecord.beds.R1.secondarySpecialty = 'Interconsulta libre';
    previousRecord.beds.R1.status = PatientStatus.DE_CUIDADO;
    previousRecord.beds.R1.pathology = 'Diagnostico local pendiente';

    const incomingRecord = DataFactory.createMockDailyRecord('2025-01-08');
    incomingRecord.lastUpdated = '2025-01-08T12:00:05.000Z';
    incomingRecord.beds.R1.clinicalEpisodeId = 'ep-r1';
    incomingRecord.beds.R1.rut = '11.111.111-1';
    incomingRecord.beds.R1.admissionDate = '2025-01-08';
    incomingRecord.beds.R1.specialty = 'Medicina';
    incomingRecord.beds.R1.secondarySpecialty = '';
    incomingRecord.beds.R1.status = PatientStatus.ESTABLE;
    incomingRecord.beds.R1.pathology = 'Diagnostico remoto concurrente';

    queryClient.setQueryData(getDailyRecordQueryKey('2025-01-08'), {
      record: previousRecord,
      runtime: {
        date: '2025-01-08',
        availabilityState: 'resolved',
        consistencyState: 'local_only',
        sourceOfTruth: 'local',
        retryability: 'not_applicable',
        recoveryAction: 'none',
        conflictSummary: null,
        observabilityTags: ['daily_record', 'read'],
        repairApplied: false,
      },
    });

    const unregister = registerPendingDailyRecordPatch('2025-01-08', {
      'beds.R1.pathology': 'Diagnostico local pendiente',
      'beds.R1.specialty': 'Otorrino libre',
      'beds.R1.secondarySpecialty': 'Interconsulta libre',
      'beds.R1.status': 'De cuidado',
    });

    const subscribe = vi.fn((_date, callback) => {
      callback(incomingRecord, false);
      return vi.fn();
    });

    createDailyRecordSubscription({ getForDate: vi.fn(), subscribe }, '2025-01-08', queryClient);

    expect(queryClient.getQueryData(getDailyRecordQueryKey('2025-01-08'))).toMatchObject({
      record: {
        beds: {
          R1: expect.objectContaining({
            specialty: 'Otorrino libre',
            secondarySpecialty: 'Interconsulta libre',
            status: 'De cuidado',
            pathology: 'Diagnostico local pendiente',
          }),
        },
      },
    });

    unregister();
    clearPendingDailyRecordPatchesForTests();
  });

  it('does not apply pending specialty patches to a different episode in the same bed', () => {
    clearPendingDailyRecordPatchesForTests();
    const queryClient = new QueryClient();
    const previousRecord = DataFactory.createMockDailyRecord('2025-01-08');
    previousRecord.lastUpdated = '2025-01-08T12:00:00.000Z';
    previousRecord.beds.R1.clinicalEpisodeId = 'ep-old';
    previousRecord.beds.R1.rut = '11.111.111-1';
    previousRecord.beds.R1.admissionDate = '2025-01-08';
    previousRecord.beds.R1.admissionTime = '08:00';
    previousRecord.beds.R1.specialty = 'Otorrino libre';

    const incomingRecord = DataFactory.createMockDailyRecord('2025-01-08');
    incomingRecord.lastUpdated = '2025-01-08T12:00:05.000Z';
    incomingRecord.beds.R1.clinicalEpisodeId = 'ep-new';
    incomingRecord.beds.R1.rut = '11.111.111-1';
    incomingRecord.beds.R1.admissionDate = '2025-01-08';
    incomingRecord.beds.R1.admissionTime = '16:00';
    incomingRecord.beds.R1.specialty = 'Medicina';

    queryClient.setQueryData(getDailyRecordQueryKey('2025-01-08'), {
      record: previousRecord,
      runtime: {
        date: '2025-01-08',
        availabilityState: 'resolved',
        consistencyState: 'local_only',
        sourceOfTruth: 'local',
        retryability: 'not_applicable',
        recoveryAction: 'none',
        conflictSummary: null,
        observabilityTags: ['daily_record', 'read'],
        repairApplied: false,
      },
    });

    const unregister = registerPendingDailyRecordPatch('2025-01-08', {
      'beds.R1.specialty': 'Otorrino libre',
    });

    const subscribe = vi.fn((_date, callback) => {
      callback(incomingRecord, false);
      return vi.fn();
    });

    createDailyRecordSubscription({ getForDate: vi.fn(), subscribe }, '2025-01-08', queryClient);

    expect(queryClient.getQueryData(getDailyRecordQueryKey('2025-01-08'))).toMatchObject({
      record: {
        beds: {
          R1: expect.objectContaining({
            specialty: 'Medicina',
            clinicalEpisodeId: 'ep-new',
          }),
        },
      },
    });

    unregister();
    clearPendingDailyRecordPatchesForTests();
  });

  it('ignores stale null reconciliation after the subscription is cleaned up', async () => {
    const queryClient = new QueryClient();
    const previousRecord = DataFactory.createMockDailyRecord('2025-01-08');
    const deferred = Promise.withResolvers<DailyRecord | null>();

    queryClient.setQueryData(getDailyRecordQueryKey('2025-01-08'), {
      record: previousRecord,
      runtime: {
        date: '2025-01-08',
        availabilityState: 'resolved',
        consistencyState: 'local_only',
        sourceOfTruth: 'local',
        retryability: 'not_applicable',
        recoveryAction: 'none',
        conflictSummary: null,
        observabilityTags: ['daily_record', 'read'],
        repairApplied: false,
      },
    });

    const stop = vi.fn();
    const subscribe = vi.fn((_date, callback) => {
      void callback(null, false);
      return stop;
    });

    const unsubscribe = createDailyRecordSubscription(
      { getForDate: vi.fn().mockReturnValue(deferred.promise), subscribe },
      '2025-01-08',
      queryClient
    );

    unsubscribe?.();
    deferred.resolve({
      ...previousRecord,
      lastUpdated: '2025-01-08T11:00:00.000Z',
    });

    await Promise.resolve();
    await Promise.resolve();

    expect(stop).toHaveBeenCalledTimes(1);
    expect(queryClient.getQueryData(getDailyRecordQueryKey('2025-01-08'))).toMatchObject({
      record: previousRecord,
    });
  });

  it('manages query cache helpers and realtime gating', async () => {
    const queryClient = new QueryClient();
    const record = DataFactory.createMockDailyRecord('2025-01-08');

    setDailyRecordQueryData(queryClient, '2025-01-08', record);
    expect(queryClient.getQueryData(getDailyRecordQueryKey('2025-01-08'))).toMatchObject({
      record,
      runtime: {
        availabilityState: 'resolved',
      },
    });

    invalidateDailyRecordQuery(queryClient, '2025-01-08');
    expect(shouldUseDailyRecordRealtimeSync('2025-01-08', false, 'ready')).toBe(true);
    expect(shouldUseDailyRecordRealtimeSync('', false, 'ready')).toBe(false);
    expect(buildPreviousDayDate('2025-01-08')).toBe('2025-01-07');
  });
});
