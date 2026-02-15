import { describe, expect, it } from 'vitest';
import {
  isMovementDateAllowed,
  isMovementDateTimeAllowed,
  MOVEMENT_DATE_TIME_OUT_OF_RANGE_ERROR,
  resolveMovementDateForRecordShift,
  resolveMovementDateTimeBounds,
  resolveMovementDateTimeValidationError,
  resolveMovementEditorInitialDate,
  resolveMovementTimeInputMax,
} from '@/features/census/controllers/clinicalShiftCalendarController';

describe('clinicalShiftCalendarController', () => {
  it('infers next day for madrugada movement time', () => {
    expect(resolveMovementDateForRecordShift('2026-02-14', undefined, '08:30')).toBe('2026-02-15');
    expect(resolveMovementDateForRecordShift('2026-02-14', undefined, '09:00')).toBe('2026-02-14');
  });

  it('resolves movement date bounds from clinical shift', () => {
    const bounds = resolveMovementDateTimeBounds('2024-12-11');
    expect(bounds.minDate).toBe('2024-12-11');
    expect(bounds.maxDate).toBe('2024-12-12');
    expect(bounds.nextDayMaxTime).toBe('07:59');
  });

  it('accepts only record date and next day as movement date', () => {
    expect(isMovementDateAllowed('2024-12-11', '2024-12-11')).toBe(true);
    expect(isMovementDateAllowed('2024-12-11', '2024-12-12')).toBe(true);
    expect(isMovementDateAllowed('2024-12-11', '2024-12-13')).toBe(false);
  });

  it('limits next-day time to night cutoff', () => {
    expect(isMovementDateTimeAllowed('2026-02-14', '2026-02-15', '08:59')).toBe(true);
    expect(isMovementDateTimeAllowed('2026-02-14', '2026-02-15', '09:00')).toBe(false);
  });

  it('exposes canonical validation error for out-of-range date time', () => {
    expect(
      resolveMovementDateTimeValidationError({
        recordDate: '2024-12-11',
        movementDate: '2024-12-12',
        movementTime: '10:00',
      })
    ).toBe(MOVEMENT_DATE_TIME_OUT_OF_RANGE_ERROR);
  });

  it('computes input max only when next-day date is selected', () => {
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

  it('keeps explicit movement date on editor initialization', () => {
    expect(resolveMovementEditorInitialDate('2024-12-11', '2024-12-11', '02:00')).toBe(
      '2024-12-11'
    );
  });
});
