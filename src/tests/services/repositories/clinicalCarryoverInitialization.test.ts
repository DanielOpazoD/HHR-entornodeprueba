import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DataFactory } from '@/tests/factories/DataFactory';
import { buildInitializedDayRecord } from '@/services/repositories/dailyRecordInitializationSupport';
import { preparePatientForCarryover } from '@/services/repositories/dailyRecordClinicalDomainService';
import { applyClinicalDayCarryover } from '@/services/repositories/clinicalDayCarryover';
import type { PatientVitalSigns } from '@/types/domain/vitalSigns';

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-19T16:00:00Z'));
});
afterEach(() => vi.useRealTimers());
const record = () =>
  DataFactory.createMockDailyRecord('2026-10-18', {
    beds: {
      R1: DataFactory.createMockPatient('R1', {
        clinicalEpisodeId: 'synthetic-episode',
        rut: '12345678-5',
        admissionDate: '2026-10-17',
        admissionTime: '08:00',
        vitalSigns: {
          recordedDate: '2026-10-18',
          recordedAt: '2026-10-18 10:30',
          heartRate: 72,
        } as PatientVitalSigns,
        devices: ['CUP'],
        deviceDetails: { CUP: { installationDate: '2026-10-17' } },
      }),
    },
  });
describe('actual new-day copy entry point', () => {
  it('carries previous clinical evidence only into today and does not mutate yesterday', () => {
    const source = record();
    const before = structuredClone(source);
    const result = applyClinicalDayCarryover(
      buildInitializedDayRecord('2026-10-19', source),
      source
    );
    expect(result.beds.R1.vitalSigns?.heartRate).toBe(72);
    expect(result.beds.R1.clinicalCarryover?.sourceDate).toBe('2026-10-18');
    expect(result.beds.R1.devices).toEqual(['CUP']);
    expect(source).toEqual(before);
  });
  it.each(['2026-10-18', '2026-10-20'])(
    'does not introduce clinical carryover on another day: %s',
    date => {
      const source = record();
      const result = applyClinicalDayCarryover(buildInitializedDayRecord(date, source), source);
      expect(result.beds.R1.vitalSigns).toBeUndefined();
      expect(result.beds.R1.clinicalCarryover).toBeUndefined();
    }
  );
  it('does not silently add clinical fields to the separate single-patient copy path', () => {
    expect(preparePatientForCarryover(record().beds.R1, 'R2').vitalSigns).toBeUndefined();
  });
  it('does not inherit maternal vitals into a crib lacking its own stable identity', () => {
    const source = record();
    source.beds.R1.clinicalCrib = DataFactory.createMockPatient('R1', {
      clinicalEpisodeId: undefined,
      rut: '',
      admissionDate: '2026-10-18',
      vitalSigns: source.beds.R1.vitalSigns,
    });
    const result = applyClinicalDayCarryover(
      buildInitializedDayRecord('2026-10-19', source),
      source
    );
    expect(result.beds.R1.vitalSigns).toBeDefined();
    expect(result.beds.R1.clinicalCrib?.vitalSigns).toBeUndefined();
  });
});
