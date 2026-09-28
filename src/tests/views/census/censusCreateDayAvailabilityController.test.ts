// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import {
  formatCopyUnlockCountdown,
  resolveCreateDayCopyAvailability,
} from '@/features/census/controllers/censusCreateDayAvailabilityController';

describe('censusCreateDayAvailabilityController', () => {
  it('locks copy-from-previous before 08:00 when the selected date is today', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 2, 3, 7, 30, 0));

    const availability = resolveCreateDayCopyAvailability('2026-03-03', new Date());

    expect(availability.isCopyLocked).toBe(true);
    expect(availability.countdownLabel).toBe('00:30:00');

    vi.useRealTimers();
  });

  it('unlocks copy-from-previous from 08:00 onward on the same day', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 2, 3, 8, 0, 0));

    const availability = resolveCreateDayCopyAvailability('2026-03-03', new Date());

    expect(availability.isCopyLocked).toBe(false);
    expect(availability.countdownLabel).toBeNull();

    vi.useRealTimers();
  });

  it('does not lock copy-from-previous for dates that are not today', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 2, 3, 6, 0, 0));

    const availability = resolveCreateDayCopyAvailability('2026-03-02', new Date());

    expect(availability.isCopyLocked).toBe(false);
    expect(availability.countdownLabel).toBeNull();
    expect(availability.isTargetToday).toBe(false);

    vi.useRealTimers();
  });

  it('locks copy-from-previous for tomorrow until 08:00 of the selected day', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 2, 3, 8, 0, 0));

    const availability = resolveCreateDayCopyAvailability('2026-03-04', new Date());

    expect(availability.isCopyLocked).toBe(true);
    expect(availability.countdownLabel).toBe('24:00:00');
    expect(availability.isTargetToday).toBe(false);

    vi.useRealTimers();
  });

  it('formats countdown in hh:mm:ss', () => {
    expect(formatCopyUnlockCountdown(3723000)).toBe('01:02:03');
  });
});
