import { describe, expect, it } from 'vitest';
import {
  isMovementDateAllowed,
  isMovementDateTimeAllowed,
  MOVEMENT_DATE_TIME_OUT_OF_RANGE_ERROR,
  resolveMovementDisplayDate,
  resolveMovementDisplayDateLabel,
  resolveMovementDateTimeDisplayValue,
  resolveMovementDateTimeBounds,
  resolveMovementEditorInitialDate,
  resolveMovementTimeInputMax,
  resolveMovementDateTimeValidationError,
} from '@/features/census/controllers/censusMovementDatePresentationController';

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
    expect(resolveMovementEditorInitialDate('2024-12-11', '2024-12-11', '02:00')).toBe(
      '2024-12-11'
    );
  });

  it('validates allowed date range and next-day madrugada times', () => {
    const bounds = resolveMovementDateTimeBounds('2024-12-11');
    expect(bounds.minDate).toBe('2024-12-11');
    expect(bounds.maxDate).toBe('2024-12-12');

    expect(isMovementDateAllowed('2024-12-11', '2024-12-11')).toBe(true);
    expect(isMovementDateAllowed('2024-12-11', '2024-12-12')).toBe(true);
    expect(isMovementDateAllowed('2024-12-11', '2024-12-13')).toBe(false);

    expect(isMovementDateTimeAllowed('2024-12-11', '2024-12-11', '14:00')).toBe(true);
    expect(isMovementDateTimeAllowed('2024-12-11', '2024-12-12', '02:00')).toBe(true);
    expect(isMovementDateTimeAllowed('2024-12-11', '2024-12-12', '10:00')).toBe(false);
  });

  it('rejects invalid time formats and out-of-range minutes', () => {
    expect(isMovementDateTimeAllowed('2024-12-11', '2024-12-12', '25:00')).toBe(false);
    expect(isMovementDateTimeAllowed('2024-12-11', '2024-12-12', '08:99')).toBe(false);
    expect(resolveMovementDisplayDate('2024-12-11', undefined, 'xx:yy')).toBe('2024-12-11');
  });

  it('allows next-day night window until one minute before dynamic cutoff', () => {
    // 2026-02-14 -> next day sunday => cutoff 09:00
    expect(isMovementDateTimeAllowed('2026-02-14', '2026-02-15', '08:59')).toBe(true);
    expect(isMovementDateTimeAllowed('2026-02-14', '2026-02-15', '09:00')).toBe(false);
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

  it('resolves time input max only for next-day date', () => {
    expect(
      resolveMovementTimeInputMax({
        dateValue: '2024-12-12',
        nextDay: '2024-12-12',
        nextDayMaxTime: '08:59',
      })
    ).toBe('08:59');

    expect(
      resolveMovementTimeInputMax({
        dateValue: '2024-12-11',
        nextDay: '2024-12-12',
        nextDayMaxTime: '08:59',
      })
    ).toBeUndefined();
  });

  it('returns canonical out-of-range error message', () => {
    expect(
      resolveMovementDateTimeValidationError({
        recordDate: '2024-12-11',
        movementDate: '2024-12-12',
        movementTime: '10:00',
      })
    ).toBe(MOVEMENT_DATE_TIME_OUT_OF_RANGE_ERROR);

    expect(
      resolveMovementDateTimeValidationError({
        recordDate: '2024-12-11',
        movementDate: '2024-12-12',
        movementTime: '02:00',
      })
    ).toBeUndefined();
  });
});
