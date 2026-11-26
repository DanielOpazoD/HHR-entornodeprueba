// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';
import {
  canApplyPreviousDayCudyr,
  canCleanInvalidEpisodeDay,
  canReleaseClosedWindowRefusals,
  canWriteCensusDay,
} from '@/shared/access/censusDayWriteAccessPolicy';
import { isAdminAppRole } from '@/shared/access/operationalAccessPolicy';

const HOUR_MS = 60 * 60 * 1000;
/** Rapa Nui midnight of 2026-11-15 and 2026-11-16, summer time (UTC-5). */
const MIDNIGHT_15 = Date.parse('2026-11-15T05:00:00.000Z');
const MIDNIGHT_16 = Date.parse('2026-11-16T05:00:00.000Z');
/** 10:00 in Rapa Nui on 2026-11-15. */
const NOW = MIDNIGHT_15 + 10 * HOUR_MS;

const ROLES = [
  'admin',
  'nurse_hospital',
  'editor',
  'viewer',
  'doctor_urgency',
  'doctor_specialist',
  undefined,
  null,
  'Admin',
  'enfermera',
] as const;

/** Day → inside the nurse window at NOW: from 24 h before to 48 h after its Rapa Nui midnight. */
const DAYS: ReadonlyArray<readonly [string, boolean]> = [
  ['2026-11-13', false],
  ['2026-11-14', true],
  ['2026-11-15', true],
  ['2026-11-16', true],
  ['2026-11-17', false],
  ['2026-11-1', false],
  ['', false],
];

const originalTimezone = process.env.TZ;

describe.each([
  'Pacific/Easter',
  'America/Santiago',
  'UTC',
  'Pacific/Auckland',
  'Pacific/Pago_Pago',
])('«¿puede escribir este día?» per operation, on a device in %s', timezone => {
  afterEach(() => {
    if (originalTimezone === undefined) delete process.env.TZ;
    else process.env.TZ = originalTimezone;
  });

  it('frees only the administrator from the window when editing the census or correcting from Rayen', () => {
    process.env.TZ = timezone;
    for (const role of ROLES) {
      const isAdmin = isAdminAppRole(role ?? undefined);
      expect(isAdmin, String(role)).toBe(role === 'admin');
      for (const [day, inside] of DAYS) {
        expect(canWriteCensusDay(day, isAdmin, NOW), `${String(role)} ${day}`).toBe(
          isAdmin || inside
        );
      }
    }
  });

  it('keeps the invalid-episode cleanup inside the window for every role, the administrator too', () => {
    process.env.TZ = timezone;
    for (const [day, inside] of DAYS) {
      expect(canCleanInvalidEpisodeDay(day, NOW), day).toBe(inside);
      // The difference that keeps two predicates: the administrator corrects, but never cleans,
      // a day outside the window.
      if (!inside) expect(canWriteCensusDay(day, true, NOW), day).toBe(true);
    }
  });

  it('closes the window at the exact hospital instant, 48 h after the day starts', () => {
    process.env.TZ = timezone;
    expect(canWriteCensusDay('2026-11-14', false, MIDNIGHT_16 - 1)).toBe(true);
    expect(canWriteCensusDay('2026-11-14', false, MIDNIGHT_16)).toBe(false);
    expect(canCleanInvalidEpisodeDay('2026-11-14', MIDNIGHT_16 - 1)).toBe(true);
    expect(canCleanInvalidEpisodeDay('2026-11-14', MIDNIGHT_16)).toBe(false);
    expect(canWriteCensusDay('2026-11-14', true, MIDNIGHT_16)).toBe(true);
  });
});

describe('CUDYR of the previous census day from a Rayen run', () => {
  it('needs the administrator or hospital nursing and the calendar day before the source', () => {
    for (const role of ROLES) {
      const allowed = role === 'admin' || role === 'nurse_hospital';
      expect(
        canApplyPreviousDayCudyr({ role, censusDay: '2026-11-14', sourceDate: '2026-11-15' }),
        String(role)
      ).toBe(allowed);
      for (const censusDay of ['2026-11-13', '2026-11-15', '2026-11-16']) {
        expect(
          canApplyPreviousDayCudyr({ role, censusDay, sourceDate: '2026-11-15' }),
          `${String(role)} ${censusDay}`
        ).toBe(false);
      }
    }
    // A calendar day, not 48 h, and across a month and a year.
    expect(
      canApplyPreviousDayCudyr({ role: 'admin', censusDay: '2026-10-31', sourceDate: '2026-11-01' })
    ).toBe(true);
    expect(
      canApplyPreviousDayCudyr({ role: 'admin', censusDay: '2025-12-31', sourceDate: '2026-01-01' })
    ).toBe(true);
    expect(
      canApplyPreviousDayCudyr({ role: 'admin', censusDay: '2026-11-14', sourceDate: '2026-11-1' })
    ).toBe(false);
    expect(canApplyPreviousDayCudyr({ role: 'admin', censusDay: '', sourceDate: '' })).toBe(false);
  });
});

describe('releasing census sends refused after the window closed', () => {
  it('belongs to hospital nursing only', () => {
    for (const role of ROLES) {
      expect(canReleaseClosedWindowRefusals(role), String(role)).toBe(role === 'nurse_hospital');
    }
  });
});
