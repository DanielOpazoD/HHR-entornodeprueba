// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import {
  formatCopyUnlockCountdown,
  resolveCreateDayCopyAvailability,
} from '@/features/census/controllers/censusCreateDayAvailabilityController';

describe('censusCreateDayAvailabilityController', () => {
  it('locks copy-from-previous before 08:00 when the selected date is today', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-03T07:30:00-05:00'));

    const availability = resolveCreateDayCopyAvailability('2026-03-03', new Date());

    expect(availability.isCopyLocked).toBe(true);
    expect(availability.countdownLabel).toBe('00:30:00');

    vi.useRealTimers();
  });

  it('unlocks copy-from-previous from 08:00 onward on the same day', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-03T08:00:00-05:00'));

    const availability = resolveCreateDayCopyAvailability('2026-03-03', new Date());

    expect(availability.isCopyLocked).toBe(false);
    expect(availability.countdownLabel).toBeNull();

    vi.useRealTimers();
  });

  it('does not lock copy-from-previous for dates that are not today', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-03T06:00:00-05:00'));

    const availability = resolveCreateDayCopyAvailability('2026-03-02', new Date());

    expect(availability.isCopyLocked).toBe(false);
    expect(availability.countdownLabel).toBeNull();
    expect(availability.isTargetToday).toBe(false);

    vi.useRealTimers();
  });

  it('locks copy-from-previous for tomorrow until 08:00 of the selected day', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-03T08:00:00-05:00'));

    const availability = resolveCreateDayCopyAvailability('2026-03-04', new Date());

    expect(availability.isCopyLocked).toBe(true);
    expect(availability.countdownLabel).toBe('24:00:00');
    expect(availability.isTargetToday).toBe(false);

    vi.useRealTimers();
  });

  it('waits for 08:00 in Rapa Nui even when a mainland device already shows a later hour', () => {
    // 08:30 in Santiago is 06:30 at the hospital: the night shift has not handed over yet.
    const availability = resolveCreateDayCopyAvailability(
      '2026-03-03',
      new Date('2026-03-03T08:30:00-03:00')
    );

    expect(availability.isCopyLocked).toBe(true);
    expect(availability.countdownLabel).toBe('01:30:00');
    expect(availability.unlockAt?.toISOString()).toBe('2026-03-03T13:00:00.000Z');
  });

  it('keeps the hospital date as today after mainland midnight', () => {
    // 23:30 at the hospital is already 01:30 of the next day in Santiago.
    const lateEvening = new Date('2026-03-03T23:30:00-05:00');

    expect(resolveCreateDayCopyAvailability('2026-03-03', lateEvening)).toMatchObject({
      isTargetToday: true,
      isCopyLocked: false,
    });
    expect(resolveCreateDayCopyAvailability('2026-03-04', lateEvening)).toMatchObject({
      isTargetToday: false,
      isCopyLocked: true,
      countdownLabel: '08:30:00',
    });
  });

  it('formats countdown in hh:mm:ss', () => {
    expect(formatCopyUnlockCountdown(3723000)).toBe('01:02:03');
  });
});
