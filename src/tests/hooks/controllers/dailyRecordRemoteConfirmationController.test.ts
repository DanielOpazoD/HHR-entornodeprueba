import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getDailyRecordClinicalFieldLocksByBedId,
  markDailyRecordRemoteConfirmed,
  resetDailyRecordFreshnessGateForTests,
} from '@/hooks/controllers/dailyRecordFreshnessGateController';
import { DataFactory } from '@/tests/factories/DataFactory';
import type { DailyRecord } from '@/types/domain/dailyRecord';

vi.mock('@/services/repositories/dailyRecordOperationalTelemetry', () => ({
  dailyRecordObservability: {
    recordEvent: vi.fn(),
    recordError: vi.fn(),
  },
}));

describe('daily record remote confirmation locks', () => {
  const date = '2026-05-16';

  beforeEach(() => {
    resetDailyRecordFreshnessGateForTests();
  });

  it('uses the last confirmed record when the cache already contains the newer snapshot', () => {
    const seedRecord = DataFactory.createMockDailyRecord(date);
    seedRecord.lastUpdated = '2026-05-16T10:00:00.000Z';
    seedRecord.beds.R1.pathology = 'Diagnostico inicial';
    const remoteRecord: DailyRecord = {
      ...seedRecord,
      lastUpdated: '2026-05-16T10:45:00.000Z',
      beds: {
        ...seedRecord.beds,
        R1: {
          ...seedRecord.beds.R1,
          pathology: 'Diagnostico Firebase confirmado',
        },
      },
    };

    markDailyRecordRemoteConfirmed(date, {
      source: 'subscription',
      confirmedRecord: seedRecord,
      remoteLastUpdated: seedRecord.lastUpdated,
    });
    markDailyRecordRemoteConfirmed(date, {
      source: 'subscription',
      previousRecord: remoteRecord,
      confirmedRecord: remoteRecord,
      remoteLastUpdated: remoteRecord.lastUpdated,
    });

    expect(getDailyRecordClinicalFieldLocksByBedId(date).R1?.diagnosis).toBe(true);
  });

  it('does not create hard locks when the newer snapshot confirms the local write', () => {
    const emptyRecord = DataFactory.createMockDailyRecord(date);
    emptyRecord.lastUpdated = '2026-05-16T10:00:00.000Z';
    const admittedRecord: DailyRecord = {
      ...emptyRecord,
      lastUpdated: '2026-05-16T10:45:00.000Z',
      beds: {
        ...emptyRecord.beds,
        R3: DataFactory.createMockPatient('R3', {
          patientName: 'Paciente Nuevo',
          rut: '17.752.753-K',
          admissionDate: date,
        }),
      },
    };

    markDailyRecordRemoteConfirmed(date, {
      source: 'subscription',
      confirmedRecord: emptyRecord,
      remoteLastUpdated: emptyRecord.lastUpdated,
    });
    markDailyRecordRemoteConfirmed(date, {
      source: 'write',
      confirmedRecord: admittedRecord,
      remoteLastUpdated: admittedRecord.lastUpdated,
    });

    expect(getDailyRecordClinicalFieldLocksByBedId(date).R3?.allClinical).toBeUndefined();
  });
});
