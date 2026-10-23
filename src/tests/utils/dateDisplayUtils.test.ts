// @vitest-environment node

import { describe, expect, it } from 'vitest';

import {
  formatCalendarDate,
  formatDateForDisplay,
  formatDateTimeCL,
  formatTimeHHMM,
  readClinicalTimestamp,
} from '@/utils/dateDisplayUtils';

// Tests run on a mainland clock (TZ=America/Santiago), two hours ahead of the hospital, so every
// instant below would read differently on the device clock.

describe('formatDateTimeCL', () => {
  it('returns the original input unchanged when it is not a parseable date', () => {
    expect(formatDateTimeCL('not-a-date')).toBe('not-a-date');
    expect(formatDateTimeCL('')).toBe('');
  });

  it('renders a 2-digit day/month, 4-digit year and a 24-hour hospital time', () => {
    // 22:30Z in June is 16:30 in Rapa Nui (UTC-6) and 18:30 in Santiago.
    const formatted = formatDateTimeCL('2026-06-25T22:30:00.000Z');
    expect(formatted).toMatch(/\b25\b/);
    expect(formatted).toMatch(/\b06\b/);
    expect(formatted).toMatch(/\b2026\b/);
    expect(formatted).toContain('16:30');
    expect(formatted).not.toMatch(/[ap]\.?\s*m\.?/i);
  });

  it('reads instants on the hospital clock, not the device clock', () => {
    expect(formatDateTimeCL('2026-07-17T07:00:00.000Z')).toContain('01:00');
    // 04:30Z on Oct 22 is still Oct 21 in Rapa Nui (UTC-5) but Oct 22 in Santiago.
    expect(formatDateTimeCL('2026-10-22T04:30:00.000Z')).toMatch(/^21-10-2026, 23:30$/);
  });

  it('shows zone-less wall-clock readings (Rayen, datetime-local) as written', () => {
    expect(formatDateTimeCL('2026-07-16T00:30')).toMatch(/^16-07-2026, 00:30$/);
    expect(formatTimeHHMM('2026-07-16 10:05:00')).toBe('10:05');
  });
});

describe('formatTimeHHMM', () => {
  it('reads instants on the hospital clock', () => {
    expect(formatTimeHHMM('2026-06-25T22:30:00.000Z')).toBe('16:30');
  });
});

describe('formatCalendarDate', () => {
  it('formats a calendar day without shifting it to the device or hospital zone', () => {
    expect(
      formatCalendarDate('2026-10-22', { weekday: 'long', day: 'numeric', month: 'long' })
    ).toBe('jueves, 22 de octubre');
    expect(formatCalendarDate('2026-10-22')).toBe('22-10-2026');
  });

  it('returns null for anything that is not a calendar day', () => {
    expect(formatCalendarDate('2026-10-22T10:00:00.000Z')).toBeNull();
    expect(formatCalendarDate('22-10-2026')).toBeNull();
    expect(formatCalendarDate('')).toBeNull();
  });
});

describe('formatDateForDisplay', () => {
  it('formats a calendar day string as that same day', () => {
    expect(formatDateForDisplay('2024-12-25')).toBe('miércoles, 25 de diciembre de 2024');
  });

  it('formats a Date as the hospital day', () => {
    // Santiago midnight of Dec 26 is still Dec 25 22:00 in Rapa Nui.
    expect(formatDateForDisplay(new Date('2024-12-26T03:00:00.000Z'))).toBe(
      'miércoles, 25 de diciembre de 2024'
    );
  });
});

describe('readClinicalTimestamp', () => {
  it('reads instants on the hospital clock', () => {
    expect(readClinicalTimestamp('2026-10-22T04:30:00.000Z')).toEqual({
      iso: '2026-10-21',
      hhmm: '23:30',
    });
  });

  it('keeps zone-less wall-clock readings as written', () => {
    expect(readClinicalTimestamp('2026-07-12T08:00:00')).toEqual({
      iso: '2026-07-12',
      hhmm: '08:00',
    });
    expect(readClinicalTimestamp('2026-07-12 23:59')).toEqual({ iso: '2026-07-12', hhmm: '23:59' });
  });

  it('returns null for values that are not dates', () => {
    expect(readClinicalTimestamp('not-a-date')).toBeNull();
    expect(readClinicalTimestamp('')).toBeNull();
  });
});
