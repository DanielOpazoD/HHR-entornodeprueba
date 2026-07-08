import { afterEach, describe, expect, it, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { DataFactory } from '@/tests/factories/DataFactory';
import { PatientStatus } from '@/types/domain/patientClassification';
import {
  createDailyRecordSubscription,
  getDailyRecordQueryKey,
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

describe('daily record pending status episode hydration', () => {
  afterEach(() => {
    clearPendingDailyRecordPatchesForTests();
  });

  it('keeps a pending clinical status visible when Firebase hydrates the new episode id later', () => {
    const queryClient = new QueryClient();
    const previousRecord = DataFactory.createMockDailyRecord('2025-01-08');
    previousRecord.lastUpdated = '2025-01-08T12:00:00.000Z';
    previousRecord.beds.R1.clinicalEpisodeId = undefined;
    previousRecord.beds.R1.patientName = 'Paciente Nuevo';
    previousRecord.beds.R1.rut = '11.111.111-1';
    previousRecord.beds.R1.admissionDate = '2025-01-08';
    previousRecord.beds.R1.admissionTime = '08:00';
    previousRecord.beds.R1.status = PatientStatus.GRAVE;

    const incomingRecord = DataFactory.createMockDailyRecord('2025-01-08');
    incomingRecord.lastUpdated = '2025-01-08T12:00:05.000Z';
    incomingRecord.beds.R1.clinicalEpisodeId = 'ep-r1-from-firestore';
    incomingRecord.beds.R1.patientName = 'Paciente Nuevo';
    incomingRecord.beds.R1.rut = '11.111.111-1';
    incomingRecord.beds.R1.admissionDate = '2025-01-08';
    incomingRecord.beds.R1.admissionTime = '08:00';
    incomingRecord.beds.R1.status = PatientStatus.EMPTY;

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
      'beds.R1.status': PatientStatus.GRAVE,
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
            clinicalEpisodeId: 'ep-r1-from-firestore',
            status: PatientStatus.GRAVE,
          }),
        },
      },
    });

    unregister();
  });

  it('purges pending status patches from an older episode before later snapshots can reuse them', () => {
    const queryClient = new QueryClient();
    const previousRecord = DataFactory.createMockDailyRecord('2025-01-08');
    previousRecord.lastUpdated = '2025-01-08T12:00:00.000Z';
    previousRecord.beds.R1.clinicalEpisodeId = 'ep-old';
    previousRecord.beds.R1.patientName = 'Paciente Antiguo';
    previousRecord.beds.R1.rut = '11.111.111-1';
    previousRecord.beds.R1.admissionDate = '2025-01-08';
    previousRecord.beds.R1.admissionTime = '08:00';
    previousRecord.beds.R1.status = PatientStatus.GRAVE;

    const firstIncomingRecord = DataFactory.createMockDailyRecord('2025-01-08');
    firstIncomingRecord.lastUpdated = '2025-01-08T12:00:05.000Z';
    firstIncomingRecord.beds.R1.clinicalEpisodeId = 'ep-new';
    firstIncomingRecord.beds.R1.patientName = 'Paciente Nuevo';
    firstIncomingRecord.beds.R1.rut = '22.222.222-2';
    firstIncomingRecord.beds.R1.admissionDate = '2025-01-08';
    firstIncomingRecord.beds.R1.admissionTime = '15:30';
    firstIncomingRecord.beds.R1.status = PatientStatus.ESTABLE;

    const secondIncomingRecord = {
      ...firstIncomingRecord,
      lastUpdated: '2025-01-08T12:00:10.000Z',
      beds: {
        ...firstIncomingRecord.beds,
        R1: {
          ...firstIncomingRecord.beds.R1,
          status: PatientStatus.ESTABLE,
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

    const unregister = registerPendingDailyRecordPatch('2025-01-08', {
      'beds.R1.status': PatientStatus.GRAVE,
    });

    const subscribe = vi.fn((_date, callback) => {
      callback(firstIncomingRecord, false);
      callback(secondIncomingRecord, false);
      return vi.fn();
    });

    createDailyRecordSubscription({ getForDate: vi.fn(), subscribe }, '2025-01-08', queryClient);

    expect(queryClient.getQueryData(getDailyRecordQueryKey('2025-01-08'))).toMatchObject({
      record: {
        beds: {
          R1: expect.objectContaining({
            clinicalEpisodeId: 'ep-new',
            patientName: 'Paciente Nuevo',
            status: PatientStatus.ESTABLE,
          }),
        },
      },
    });

    unregister();
  });
});
