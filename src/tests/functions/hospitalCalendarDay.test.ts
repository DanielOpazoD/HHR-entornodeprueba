// @vitest-environment node
import { createRequire } from 'node:module';
import { afterEach, describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const { hospitalCalendarDay } = require('../../../functions/lib/hospitalCalendarDay.js');
const { isCurrentRapaNuiDay } = require('../../../functions/lib/specialtyRules.js');
const instants = [
  ['2026-10-25T03:30:00.000Z', '2026-10-24'],
  ['2026-07-02T05:30:00.000Z', '2026-07-01'],
  ['2026-10-25T05:30:00.000Z', '2026-10-25'],
  ['2026-10-25T04:59:59.999Z', '2026-10-24'],
  ['2026-10-25T05:00:00.000Z', '2026-10-25'],
  ['2027-01-01T02:00:00.000Z', '2026-12-31'],
];

afterEach(() => vi.useRealTimers());

describe('hospital calendar day', () => {
  it.each(instants)('formats %s as %s using the IANA summer/winter offset', (instant, expected) => {
    const date = new Date(instant);
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Pacific/Easter',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(date);
    const calendar = Object.fromEntries(parts.map(part => [part.type, part.value]));
    expect(`${calendar.year}-${calendar.month}-${calendar.day}`).toBe(expected);
    expect(hospitalCalendarDay(date)).toBe(expected);
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(date);
    expect(hospitalCalendarDay()).toBe(expected);
  });

  it('preserves the former specialty clock for every hour across a year and both DST changes', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Pacific/Easter',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    for (
      let ms = Date.parse('2026-01-01T00:00Z');
      ms <= Date.parse('2027-01-01T06:00Z');
      ms += 3_600_000
    ) {
      const instant = new Date(ms);
      vi.setSystemTime(instant);
      const calendar = Object.fromEntries(
        formatter.formatToParts(instant).map(part => [part.type, part.value])
      );
      const legacyDay = `${calendar.year}-${calendar.month}-${calendar.day}`;
      expect(hospitalCalendarDay(instant)).toBe(legacyDay);
      expect(isCurrentRapaNuiDay(legacyDay)).toBe(true);
      expect(isCurrentRapaNuiDay('1900-01-01')).toBe(false);
    }
  });
});
