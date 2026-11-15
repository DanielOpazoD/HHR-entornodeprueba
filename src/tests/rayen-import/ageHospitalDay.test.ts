import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ageFromBirthDate,
  rayenToPatientData,
} from '@/features/rayen-import/mapping/rayenToPatientData';
import { isNeonatalPatient } from '@/features/rayen-import/domain/clinicalCribMaternalAssociation';

const originalTZ = process.env.TZ;
afterEach(() => {
  if (originalTZ === undefined) delete process.env.TZ;
  else process.env.TZ = originalTZ;
  vi.useRealTimers();
});

const cases = [
  ...['22:30', '00:30'].flatMap(time => [
    {
      at: `2026-07-31T${time}:00-06:00`,
      births: [
        ['2026-07-31', '0d'],
        ['2026-07-30', '1d'],
        ['2026-07-02', '29d'],
        ['2026-07-01', '30d'],
        ['2026-06-30', '1m 1d'],
        ['2000-07-31', '26'],
        ['2000-07-30', '26'],
        ['2000-08-01', '25'],
      ],
    },
    {
      at: `2026-01-31T${time}:00-05:00`,
      births: [
        ['2026-01-31', '0d'],
        ['2026-01-30', '1d'],
        ['2026-01-02', '29d'],
        ['2026-01-01', '30d'],
        ['2000-01-31', '26'],
        ['2000-01-30', '26'],
        ['2000-02-01', '25'],
      ],
    },
  ]),
  {
    at: '2026-02-28T22:30:00-05:00',
    births: [
      ['2024-02-29', '2a 0m'],
      ['2026-01-31', '1m 0d'],
    ],
  },
  {
    at: '2024-02-29T00:30:00-05:00',
    births: [
      ['2024-02-29', '0d'],
      ['2024-02-28', '1d'],
    ],
  },
  {
    at: '2026-12-31T22:30:00-05:00',
    births: [
      ['2000-01-01', '26'],
      ['2026-12-31', '0d'],
    ],
  },
  {
    at: '2027-01-01T00:30:00-05:00',
    births: [
      ['2000-01-01', '27'],
      ['2026-12-31', '1d'],
    ],
  },
];

describe.each([
  'UTC',
  'America/Santiago',
  'Pacific/Easter',
  'Pacific/Auckland',
  'Pacific/Pago_Pago',
])('hospital age on a %s device', zone => {
  it.each(cases)('uses the hospital date at $at', ({ at, births }) => {
    process.env.TZ = zone;
    for (const [birth, expected] of births) {
      expect(ageFromBirthDate(birth, new Date(at)), `${at} / ${birth}`).toBe(expected);
    }
  });
  it('stores the age without prematurely removing the neonatal age signal', () => {
    process.env.TZ = zone;
    const encounter = {
      encounterId: 'synthetic-episode',
      run: '',
      birthDate: '2026-07-01',
      firstGivenName: 'Persona',
      firstFamilyName: 'Sintetica',
    };
    const before = rayenToPatientData(encounter, new Date('2026-07-31T22:30:00-06:00')).patient;
    const after = rayenToPatientData(encounter, new Date('2026-08-01T00:30:00-06:00')).patient;
    expect(before.age).toBe('30d');
    expect(isNeonatalPatient(before)).toBe(true);
    expect(after.age).toBe('1m 0d');
    expect(isNeonatalPatient(after)).toBe(false);
    expect(after.clinicalEpisodeId).toBe(before.clinicalEpisodeId);
  });
  it('uses the hospital day also when reference defaults to now', () => {
    process.env.TZ = zone;
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-31T22:30:00-06:00'));
    expect(ageFromBirthDate('2026-07-31')).toBe('0d');
  });
  it('preserves invalid and future date rejection', () => {
    process.env.TZ = zone;
    const reference = new Date('2026-07-31T12:00:00-06:00');
    expect(ageFromBirthDate('2026-02-31', reference)).toBe('');
    expect(ageFromBirthDate('2026-08-01', reference)).toBe('');
    expect(ageFromBirthDate(undefined, reference)).toBe('');
    expect(ageFromBirthDate('2026-07-31', new Date(NaN))).toBe('');
  });
});
