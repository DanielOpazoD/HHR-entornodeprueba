// @vitest-environment node

import { afterEach, describe, expect, it } from 'vitest';

import {
  addCalendarDays,
  diffCalendarDays,
  normalizeCalendarDate,
  normalizeDateOnly,
  parseCalendarDateUtcNoon,
} from '@/utils/clinicalDateUtils';

describe('clinicalDateUtils', () => {
  it('normalizes ISO datetime and Chilean calendar formats', () => {
    expect(normalizeDateOnly('2026-01-23T10:30:00Z')).toBe('2026-01-23');
    expect(normalizeCalendarDate('2026-01-23T10:30:00Z')).toBe('2026-01-23');
    expect(normalizeCalendarDate('23-01-2026')).toBe('2026-01-23');
    expect(normalizeCalendarDate('invalid')).toBeUndefined();
  });

  it('parses calendar dates at UTC noon and rejects invalid values', () => {
    expect(parseCalendarDateUtcNoon('2026-01-23')).toBe(Date.UTC(2026, 0, 23, 12, 0, 0));
    expect(parseCalendarDateUtcNoon('23-01-2026')).toBe(Date.UTC(2026, 0, 23, 12, 0, 0));
    expect(parseCalendarDateUtcNoon('invalid')).toBeNull();
  });

  it('adds and diffs calendar days across month and year boundaries', () => {
    expect(addCalendarDays('2026-01-31', 1)).toBe('2026-02-01');
    expect(addCalendarDays('2026-02-01', -1)).toBe('2026-01-31');
    expect(diffCalendarDays('2026-01-23', '2026-01-26')).toBe(3);
    expect(diffCalendarDays('invalid', '2026-01-26')).toBeNull();
    expect(addCalendarDays('2024-12-31', 1)).toBe('2025-01-01');
    expect(addCalendarDays('2025-01-01', -1)).toBe('2024-12-31');
    expect(diffCalendarDays('2024-12-31', '2025-01-01')).toBe(1);
  });
});

describe('addCalendarDays across device time zones', () => {
  const deviceZone = process.env.TZ;
  afterEach(() => {
    if (deviceZone === undefined) delete process.env.TZ;
    else process.env.TZ = deviceZone;
  });

  // Auckland is ahead of UTC by more than twelve hours and Pago Pago behind by eleven: a day
  // label that passes through the device zone and back through UTC shifts in one of them.
  it.each(['Pacific/Auckland', 'Pacific/Pago_Pago', 'Pacific/Easter', 'America/Santiago', 'UTC'])(
    'shifts the calendar label the same way on a device in %s',
    zone => {
      process.env.TZ = zone;
      expect(addCalendarDays('2026-11-12', 1)).toBe('2026-11-13');
      expect(addCalendarDays('2026-12-31', 1)).toBe('2027-01-01');
      expect(addCalendarDays('2026-03-01', -1)).toBe('2026-02-28');
      expect(addCalendarDays('2026-09-05', 2)).toBe('2026-09-07');
      expect(addCalendarDays('2026-11-12', 0)).toBe('2026-11-12');
    }
  );
});
