// @vitest-environment node

import { describe, expect, it } from 'vitest';

import { isCalendarDate } from '@/utils/clinicalDateUtils';

/*
 * W21-DATE1 replaced seven hand-written calendar checks with isCalendarDate. Each copy below is
 * the predicate exactly as it was on main, so this table proves every migrated site accepts and
 * rejects the same text, impossible days and years 0000-0999 included.
 */
const MAIN_COPIES: Record<string, (value: string) => boolean> = {
  'domain/handoff/sharedChecklist': value => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const [year, month, day] = value.split('-').map(Number);
    const date = new Date(`${value}T00:00:00.000Z`);
    return (
      Number.isFinite(date.getTime()) &&
      date.getUTCFullYear() === year &&
      date.getUTCMonth() + 1 === month &&
      date.getUTCDate() === day
    );
  },
  'services/repositories/clinicalCarryoverIdentity': value => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const stamp = Date.parse(`${value}T00:00:00Z`);
    return Number.isFinite(stamp) && new Date(stamp).toISOString().slice(0, 10) === value;
  },
  'rayen-import/domain/clinicalHistoryReadPolicy': value => {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const parsed = Date.parse(`${value}T00:00:00Z`);
    return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === value;
  },
  'rayen-import/components/rayenSyncIssueSupport': date => {
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
    const parsed = new Date(`${date}T00:00:00Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date;
  },
  'rayen-import/domain/historicalReportEpisodeRecovery': value =>
    !!value &&
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) &&
    new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value,
  'cudyr/export/cudyrSourceMovements': date =>
    /^\d{4}-\d{2}-\d{2}$/.test(date) &&
    Number.isFinite(Date.parse(date)) &&
    new Date(date).toISOString().slice(0, 10) === date,
  'cudyr/export/cudyrSourceEpisode': date =>
    !(
      !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
      !Number.isFinite(Date.parse(date)) ||
      new Date(date).toISOString().slice(0, 10) !== date
    ),
};

const pad = (value: number, length: number) => String(value).padStart(length, '0');
const YEARS = [0, 1, 50, 99, 100, 999, 1000, 1900, 1970, 2000, 2024, 2025, 2026, 2100, 9999];
const GENERATED = YEARS.flatMap(year =>
  Array.from({ length: 14 }, (_, month) =>
    Array.from({ length: 33 }, (_, day) => `${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}`)
  ).flat()
);
const ODD_SHAPES = [
  '',
  ' 2026-01-01',
  '2026-01-01 ',
  '2026-01-01\n',
  '2026-1-01',
  '2026-01-1',
  '2026-11-006',
  '02026-01-01',
  '+002026-01-01',
  '2026/01/01',
  '01-01-2026',
  '2026-01-01T00:00:00Z',
  '2026-01-01T12:00',
  '２０２６-01-01',
  'texto',
];

describe('isCalendarDate keeps parity with the seven copies it replaced', () => {
  it.each(Object.entries(MAIN_COPIES))('%s', (_site, mainCopy) => {
    const differences = [...GENERATED, ...ODD_SHAPES].filter(
      value => mainCopy(value) !== isCalendarDate(value)
    );
    expect(differences).toEqual([]);
  });

  it('the table covers real days, impossible days and malformed text', () => {
    expect(['2024-02-29', '2026-12-31', '0000-01-01'].every(isCalendarDate)).toBe(true);
    expect(
      ['2025-02-29', '2026-02-30', '2026-04-31', '2026-00-10', '2026-13-01'].some(isCalendarDate)
    ).toBe(false);
    expect(GENERATED.filter(isCalendarDate)).toHaveLength(YEARS.length * 365 + 3); // leap years: 0000, 2000, 2024
  });
});
