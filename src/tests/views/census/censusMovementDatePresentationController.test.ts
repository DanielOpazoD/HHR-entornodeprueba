// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  resolveMovementDisplayDate,
  resolveMovementDisplayDateLabel,
  resolveMovementDateTimeDisplayValue,
} from '@/application/census/controllers/censusMovementDatePresentationController';

describe('censusMovementDatePresentationController', () => {
  it('returns record date when movement time is missing', () => {
    expect(resolveMovementDisplayDate('2024-12-11')).toBe('2024-12-11');
    expect(resolveMovementDisplayDateLabel('2024-12-11')).toBe('11-12-2024');
  });

  it('keeps same-day date for daytime movements', () => {
    expect(resolveMovementDisplayDate('2024-12-11', undefined, '12:30')).toBe('2024-12-11');
    expect(resolveMovementDisplayDateLabel('2024-12-11', undefined, '12:30')).toBe('11-12-2024');
  });

  it('moves madrugada movements to next day for display', () => {
    expect(resolveMovementDisplayDate('2024-12-11', undefined, '02:00')).toBe('2024-12-12');
    expect(resolveMovementDisplayDateLabel('2024-12-11', undefined, '02:00')).toBe('12-12-2024');
  });

  it('uses dynamic night end (09:00) when next day is non-business day', () => {
    // 2026-02-14 (sábado) -> next day domingo => nightEnd 09:00
    expect(resolveMovementDisplayDate('2026-02-14', undefined, '08:30')).toBe('2026-02-15');
    expect(resolveMovementDisplayDate('2026-02-14', undefined, '09:00')).toBe('2026-02-14');
  });

  it('returns fallback label for empty record date', () => {
    expect(resolveMovementDisplayDateLabel('', undefined, '10:00')).toBe('-');
  });

  it('prioritizes explicit movement date over inferred date', () => {
    expect(resolveMovementDisplayDate('2024-12-11', '2024-12-11', '02:00')).toBe('2024-12-11');
  });

  it('keeps the record date for an invalid time', () => {
    expect(resolveMovementDisplayDate('2024-12-11', undefined, 'xx:yy')).toBe('2024-12-11');
  });

  it('builds unified display value with fallback time and inferred date', () => {
    expect(resolveMovementDateTimeDisplayValue('2024-12-11', undefined, undefined)).toEqual({
      timeLabel: '--:--',
      dateLabel: '11-12-2024',
    });

    expect(resolveMovementDateTimeDisplayValue('2024-12-11', undefined, '02:00')).toEqual({
      timeLabel: '02:00',
      dateLabel: '12-12-2024',
    });
  });
});
