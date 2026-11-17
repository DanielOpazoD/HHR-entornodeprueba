// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import { buildStabilityRules } from '@/hooks/stabilityRulesController';
import { resolveCurrentClinicalDay } from '@/utils/clinicalDayAdmissionUtils';
import { clinicalWallClockToDate } from '@/utils/clinicalWallClock';

const createRecord = (date: string): DailyRecord => ({
  date,
  beds: {},
  discharges: [],
  transfers: [],
  cma: [],
  lastUpdated: `${date}T08:00:00.000Z`,
  nurses: [],
  activeExtraBeds: [],
});

describe('stabilityRulesController', () => {
  it('returns locked rules when there is no record', () => {
    const rules = buildStabilityRules(null, { isAdmin: false, isEditor: true });

    expect(rules.isDateLocked).toBe(true);
    expect(rules.canPerformActions).toBe(false);
    expect(rules.canEditField('any')).toBe(false);
  });

  it('returns locked rules for non-editor users', () => {
    const record = createRecord('2025-01-10');
    const rules = buildStabilityRules(record, { isAdmin: false, isEditor: false });

    expect(rules.isDateLocked).toBe(true);
    expect(rules.canPerformActions).toBe(false);
  });

  it('allows admin edits on historical records', () => {
    const record = createRecord('2025-01-10');
    const rules = buildStabilityRules(record, {
      isAdmin: true,
      isEditor: true,
      todayISO: '2025-01-12',
      now: new Date('2025-01-12T12:00:00.000Z'),
    });

    expect(rules.isDateLocked).toBe(false);
    expect(rules.canPerformActions).toBe(true);
    expect(rules.canEditField('handoffNoteDayShift')).toBe(true);
  });

  it('unlocks historical record within grace period', () => {
    const record = createRecord('2025-01-10');
    const rules = buildStabilityRules(record, {
      isAdmin: false,
      isEditor: true,
      todayISO: '2025-01-11',
      now: new Date('2025-01-11T14:00:00'),
    });

    expect(rules.isDateLocked).toBe(false);
    expect(rules.canPerformActions).toBe(true);
  });

  it('locks historical record outside grace period', () => {
    const record = createRecord('2025-01-10');
    const rules = buildStabilityRules(record, {
      isAdmin: false,
      isEditor: true,
      todayISO: '2025-01-11',
      now: new Date('2025-01-12T23:00:00'),
    });

    expect(rules.isDateLocked).toBe(true);
    expect(rules.canPerformActions).toBe(false);
    expect(rules.canEditField('handoffNoteNightShift')).toBe(false);
  });

  it('uses the clinical day instead of the calendar day during the overnight window', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 3, 22, 6, 59, 0));

    const record = createRecord('2026-04-21');
    const rules = buildStabilityRules(record, {
      isAdmin: false,
      isEditor: true,
      now: new Date(2026, 3, 22, 6, 59, 0),
    });

    expect(rules.isDateLocked).toBe(false);
    expect(rules.canPerformActions).toBe(true);

    vi.useRealTimers();
  });
});

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const originalTimezone = process.env.TZ;

describe.each([
  'Pacific/Easter',
  'America/Santiago',
  'UTC',
  'Pacific/Auckland',
  'Pacific/Pago_Pago',
  'Pacific/Kiritimati',
])('nurse lock on a past census day, on a device in %s', timezone => {
  afterEach(() => {
    if (originalTimezone === undefined) delete process.env.TZ;
    else process.env.TZ = originalTimezone;
  });

  // An ordinary day and the days whose 48 h cross a Rapa Nui clock change (back on the night of
  // 2026-04-04, forward on the night of 2026-09-05).
  it.each(['2026-11-15', '2026-04-03', '2026-04-04', '2026-09-04', '2026-09-05'])(
    'locks %s exactly when the server closes it, 48 h after its hospital midnight',
    day => {
      process.env.TZ = timezone;
      const midnight = clinicalWallClockToDate(day, '00:00').getTime();
      const lockedAt = (elapsed: number): boolean => {
        const now = new Date(midnight + elapsed);
        return buildStabilityRules(createRecord(day), {
          isAdmin: false,
          isEditor: true,
          todayISO: resolveCurrentClinicalDay(now),
          now,
        }).isDateLocked;
      };

      expect(lockedAt(47 * HOUR_MS + 59 * MINUTE_MS)).toBe(false);
      expect(lockedAt(48 * HOUR_MS)).toBe(true);
      expect(lockedAt(48 * HOUR_MS + MINUTE_MS)).toBe(true);
    }
  );
});
