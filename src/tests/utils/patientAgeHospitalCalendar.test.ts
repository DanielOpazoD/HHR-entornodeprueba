// @vitest-environment node

import { afterEach, describe, expect, it, vi } from 'vitest';

import { calculateFormattedAge } from '@/features/census/components/demographics/utils';
import { calculateAge } from '@/utils/clinicalUtils';
import { buildTransferPatientSnapshot } from '@/features/census/controllers/censusTransferSyncController';
import { DataFactory } from '@/tests/factories/DataFactory';

// A birth date is a calendar day and "today" is the hospital's calendar day (Rapa Nui, UTC-5 in
// November and December 2026). The age must be the same whatever zone the device runs in.
const ZONES = [
  'UTC',
  'America/Santiago',
  'Pacific/Easter',
  'Pacific/Auckland',
  'Pacific/Pago_Pago',
];

/** Instants written as Rapa Nui wall clock (UTC-5 from September to April). */
const NOON_NOV_14 = '2026-11-14T17:00:00Z'; // 12:00 Rapa Nui, 14 Nov
const LATE_NOV_14 = '2026-11-15T03:30:00Z'; // 22:30 Rapa Nui, 14 Nov (mainland already 15 Nov)
const EARLY_NOV_15 = '2026-11-15T05:30:00Z'; // 00:30 Rapa Nui, 15 Nov
const LATE_DEC_31 = '2027-01-01T03:30:00Z'; // 22:30 Rapa Nui, 31 Dec (mainland already 2027)
const NOON_FEB_28 = '2026-02-28T17:00:00Z'; // 12:00 Rapa Nui, 28 Feb 2026
const NOON_MAR_01 = '2026-03-01T17:00:00Z'; // 12:00 Rapa Nui, 1 Mar 2026
const NOON_JAN_04 = '2026-01-04T17:00:00Z'; // 12:00 Rapa Nui, 4 Jan 2026

type AgeCase = [instant: string, birthDate: string, expected: string];

const YEARS_CASES: AgeCase[] = [
  [NOON_NOV_14, '2000-11-14', '26 años'], // birthday today
  [NOON_NOV_14, '2000-11-13', '26 años'], // birthday yesterday
  [NOON_NOV_14, '2000-11-15', '25 años'], // birthday tomorrow
  [NOON_NOV_14, '14-11-2000', '26 años'], // DD-MM-YYYY
  [NOON_NOV_14, '2000-11-14T00:00:00', '26 años'], // stored with a time: the day is what counts
  [NOON_NOV_14, '2000-11-15T00:00:00', '25 años'],
  [NOON_NOV_14, '15-11-2000', '25 años'],
  [NOON_JAN_04, '5-1-2000', '25 años'], // unpadded DD-MM-YYYY, birthday tomorrow
  [NOON_JAN_04, '4-1-2000', '26 años'],
  [LATE_NOV_14, '2000-11-15', '25 años'], // the mainland is already on the birthday
  [EARLY_NOV_15, '2000-11-15', '26 años'],
  [EARLY_NOV_15, '2000-11-16', '25 años'],
  [NOON_FEB_28, '2004-02-29', '21 años'], // 29 February, not yet in a common year
  [NOON_MAR_01, '2004-02-29', '22 años'],
  [LATE_DEC_31, '2000-01-01', '26 años'], // year end
  [LATE_DEC_31, '2000-12-31', '26 años'],
];

const FORMATTED_CASES: AgeCase[] = [
  [NOON_NOV_14, '2026-11-14', '0d'], // newborn, 0 days
  [NOON_NOV_14, '2026-11-13', '1d'],
  [NOON_NOV_14, '2026-11-13T00:00:00', '1d'],
  [NOON_NOV_14, '2026-10-16', '29d'],
  [NOON_NOV_14, '2026-10-15', '0m'], // 30 days: current month arithmetic, unchanged
  [NOON_NOV_14, '2026-10-14', '1m'], // 31 days
  [NOON_NOV_14, '2025-11-14', '12m'], // birthday today
  [NOON_NOV_14, '2025-11-13', '12m'], // birthday yesterday
  [NOON_NOV_14, '2025-11-15', '11m'], // birthday tomorrow
  [NOON_NOV_14, '2023-11-14', '3a'],
  [NOON_NOV_14, '2023-11-15', '2a'],
  [LATE_NOV_14, '2026-11-14', '0d'], // 22:30: the mainland is already on day one
  [LATE_NOV_14, '2026-10-16', '29d'],
  [LATE_NOV_14, '2025-11-15', '11m'],
  [EARLY_NOV_15, '2026-11-15', '0d'],
  [EARLY_NOV_15, '2026-11-14', '1d'],
  [NOON_FEB_28, '2024-02-29', '23m'], // 29 February
  [NOON_MAR_01, '2024-02-29', '24m'],
  [LATE_DEC_31, '2026-12-03', '28d'], // year end
  [LATE_DEC_31, '2024-01-01', '2a'],
  [LATE_DEC_31, '2023-12-31', '3a'],
];

describe('patient age on the hospital calendar', () => {
  const deviceZone = process.env.TZ;

  afterEach(() => {
    vi.useRealTimers();
    if (deviceZone === undefined) delete process.env.TZ;
    else process.env.TZ = deviceZone;
  });

  const at = (zone: string, instant: string) => {
    process.env.TZ = zone;
    vi.useFakeTimers({ now: new Date(instant) });
  };

  describe.each(ZONES)('on a device in %s', zone => {
    it.each(YEARS_CASES)('calculateAge at %s born %s → %s', (instant, birthDate, expected) => {
      at(zone, instant);
      expect(calculateAge(birthDate)).toBe(expected);
    });

    it.each(FORMATTED_CASES)(
      'calculateFormattedAge at %s born %s → %s',
      (instant, birthDate, expected) => {
        at(zone, instant);
        expect(calculateFormattedAge(birthDate)).toBe(expected);
      }
    );

    // Empty, unreadable and future dates keep exactly the output they had before.
    it('keeps the output for empty, invalid and future dates', () => {
      at(zone, NOON_NOV_14);
      expect(calculateAge(undefined)).toBe('');
      expect(calculateAge('')).toBe('');
      expect(calculateAge('invalid')).toBe('');
      expect(calculateAge('2026-11-20')).toBe('-1 años');
      expect(calculateAge('2030-01-01')).toBe('-4 años');
      expect(calculateFormattedAge('')).toBe('');
      expect(calculateFormattedAge('2026-11-15')).toBe('');
      expect(calculateFormattedAge('2030-01-01')).toBe('');
    });
  });
});

describe('a newborn age from the demographics form to the transfer request', () => {
  const deviceZone = process.env.TZ;
  afterEach(() => {
    vi.useRealTimers();
    if (deviceZone === undefined) delete process.env.TZ;
    else process.env.TZ = deviceZone;
  });

  // Born 16 Oct 2026, saved 14 Nov at 22:30 Rapa Nui: 29 days old, zero completed years.
  it.each(ZONES)('saves 29d and transfers zero years on a %s computer', zone => {
    process.env.TZ = zone;
    vi.useFakeTimers();
    vi.setSystemTime(new Date(LATE_NOV_14));
    const saved = calculateFormattedAge('2026-10-16');

    expect(saved).toBe('29d');
    for (const birthDate of ['2026-10-16', '']) {
      const patient = DataFactory.createMockPatient('R1', { age: saved, birthDate });
      expect(buildTransferPatientSnapshot(patient, '2026-11-14').age).toBe(0);
    }
  });
});
