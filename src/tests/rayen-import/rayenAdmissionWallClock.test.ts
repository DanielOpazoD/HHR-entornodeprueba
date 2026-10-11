import { describe, expect, it } from 'vitest';
import { EMPTY_PATIENT } from '@/constants/patient';
import {
  rayenToPatientData,
  extractTime,
} from '@/features/rayen-import/mapping/rayenToPatientData';
import { clinicalAdmissionDay } from '@/features/rayen-import/domain/censusDayPolicy';
import { createDischargedEncounterMatcher } from '@/features/rayen-import/domain/censusDischargeHistory';
import { filterRecordedOutcomeActions } from '@/features/rayen-import/domain/filterRecordedOutcomeActions';
import { resolveClinicalDayForDateTime } from '@/utils/clinicalDayAdmissionUtils';
import type { DailyRecord } from '@/features/rayen-import/contracts/rayenDomainContracts';
import type { CensusImportDiff } from '@/features/rayen-import/contracts/censusImportDiff';
import type { RayenEncounter } from '@/features/rayen-import/contracts/rayenSnapshot';

const encounter = (admissionDatetime?: string): RayenEncounter => ({
  encounterId: 'episode-synthetic',
  run: 'TEST-0001',
  firstGivenName: 'Caso',
  firstFamilyName: 'Sintético',
  admissionDatetime,
});

describe('admission wall clock across mapper and nursing-day policy', () => {
  it.each([
    ['2026-07-08T02:30:00Z', '2026-07-07', '20:30', '2026-07-07'],
    ['2026-07-08T02:30:00-03:00', '2026-07-07', '23:30', '2026-07-07'],
    ['2026-07-08T14:19:46-06:00', '2026-07-08', '14:19', '2026-07-08'],
    ['2026-07-08T14:19:46', '2026-07-08', '14:19', '2026-07-08'],
    ['08/07/2026 14:19', '2026-07-08', '14:19', '2026-07-08'],
    ['2026-07-08T08:30:00Z', '2026-07-08', '02:30', '2026-07-07'],
    ['2026-01-08T02:30:00Z', '2026-01-07', '21:30', '2026-01-07'],
  ])('maps %s without confusing calendar and clinical days', (raw, date, time, clinicalDay) => {
    const source = encounter(raw);
    const { patient } = rayenToPatientData(source);
    expect(patient.admissionDate).toBe(date);
    expect(patient.admissionTime).toBe(time);
    expect(extractTime(raw)).toBe(time);
    expect(clinicalAdmissionDay(source)).toBe(clinicalDay);
    expect(resolveClinicalDayForDateTime(patient.admissionDate, patient.admissionTime)).toBe(
      clinicalDay
    );
  });

  it.each([undefined, '', 'not-a-date', '2026-02-31T10:00:00Z'])(
    'does not persist an invalid admission: %s',
    raw => {
      const { patient } = rayenToPatientData(encounter(raw));
      expect(patient.admissionDate).toBe('');
      expect(patient.admissionTime).toBe('');
    }
  );

  it('does not invent an admission time from a date-only value', () => {
    const { patient } = rayenToPatientData(encounter('2026-07-08'));
    expect(patient.admissionDate).toBe('2026-07-08');
    expect(patient.admissionTime).toBe('');
  });

  it.each(['2026-07-08', '2026-07-08T00:00:00Z', '2026-07-08T00:00:00-03:00'])(
    'keeps birthDate %s as a calendar date',
    birthDate => {
      const { patient } = rayenToPatientData({ ...encounter('2026-07-08T02:30:00Z'), birthDate });
      expect(patient.birthDate).toBe('2026-07-08');
      expect(patient.admissionDate).toBe('2026-07-07');
    }
  );
});

describe('legacy outcome timestamp identity', () => {
  const source = encounter('2026-07-08T02:30:00Z');
  const record = {
    date: '2026-07-07',
    beds: {},
    transfers: [],
    cma: [],
    discharges: [
      {
        rut: source.run,
        originalData: {
          ...EMPTY_PATIENT,
          rut: source.run,
          admissionDate: '2026-07-07',
          admissionTime: '20:30',
        },
      },
    ],
  } as unknown as DailyRecord;

  it('recognizes a recorded local admission timestamp from UTC evidence', () => {
    expect(createDischargedEncounterMatcher(record)(source)).toBe(true);
    expect(createDischargedEncounterMatcher(record)(encounter('2026-07-08T03:30:00Z'))).toBe(false);
  });

  it('does not propose an already recorded outcome a second time', () => {
    const diff = {
      admissions: [],
      updates: [],
      moves: [],
      discharges: [{ rut: source.run, source }],
    } as unknown as CensusImportDiff;
    expect(filterRecordedOutcomeActions(record, diff).discharges).toEqual([]);
  });
});
