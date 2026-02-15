import { describe, expect, it } from 'vitest';
import {
  isMovementDateAllowed,
  isMovementDateTimeAllowed,
  resolveMovementDisplayDate,
  resolveMovementDisplayDateLabel,
  resolveMovementDateTimeBounds,
  resolveMovementEditorInitialDate,
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
});
