import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DailyRecordDateRef } from '@/types/domain/dailyRecordSlices';
import { clinicalWallClockToDate } from '@/utils/clinicalWallClock';

const auth = vi.hoisted(() => ({ role: 'nurse_hospital', isEditor: true }));
vi.mock('@/context/AuthContext', () => ({ useAuth: () => auth }));

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY = '2026-11-15';
const originalTimezone = process.env.TZ;

const loadHook = async () =>
  (await vi.importActual<typeof import('@/hooks/useStabilityRules')>('@/hooks/useStabilityRules'))
    .useStabilityRules;

/** Opens the census of `record` at `elapsed` after DAY's hospital midnight and counts renders. */
const openCensusAt = async (elapsed: number, record: DailyRecordDateRef) => {
  const useStabilityRules = await loadHook();
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
  vi.setSystemTime(clinicalWallClockToDate(DAY, '00:00').getTime() + elapsed);
  let renders = 0;
  const view = renderHook(
    ({ current }) => {
      renders += 1;
      return useStabilityRules(current);
    },
    { initialProps: { current: record } }
  );
  return { view, renders: () => renders };
};

const passTime = (ms: number) => act(() => vi.advanceTimersByTime(ms));

describe.each(['Pacific/Easter', 'America/Santiago', 'UTC', 'Pacific/Auckland'])(
  'an open census of a past day, on a device in %s',
  timezone => {
    afterEach(() => {
      vi.useRealTimers();
      auth.role = 'nurse_hospital';
      if (originalTimezone === undefined) delete process.env.TZ;
      else process.env.TZ = originalTimezone;
    });

    it('locks for a nurse the instant the 48 h pass, without a render before', async () => {
      process.env.TZ = timezone;
      const { view, renders } = await openCensusAt(47 * HOUR_MS + 50 * MINUTE_MS, { date: DAY });
      expect(view.result.current.isDateLocked).toBe(false);
      const rendersWhenOpened = renders();

      passTime(10 * MINUTE_MS - 1);
      expect(view.result.current.isDateLocked).toBe(false);
      expect(renders()).toBe(rendersWhenOpened);

      passTime(1);
      expect(view.result.current.isDateLocked).toBe(true);
      expect(view.result.current.canEditField('beds')).toBe(false);
      expect(renders()).toBe(rendersWhenOpened + 1);
      expect(vi.getTimerCount()).toBe(0);
    });

    it('locks at once on returning to the tab after the computer slept past the 48 h', async () => {
      process.env.TZ = timezone;
      const { view } = await openCensusAt(47 * HOUR_MS, { date: DAY });
      expect(view.result.current.isDateLocked).toBe(false);

      // Asleep from 47 h to 50 h: the clock jumps and the pending timeout has not fired.
      vi.setSystemTime(clinicalWallClockToDate(DAY, '00:00').getTime() + 50 * HOUR_MS);
      act(() => {
        document.dispatchEvent(new Event('visibilitychange'));
      });
      expect(view.result.current.isDateLocked).toBe(true);
    });

    it('locks again when the clock was set back after a first close and the day refreshed', async () => {
      process.env.TZ = timezone;
      const midnight = clinicalWallClockToDate(DAY, '00:00').getTime();
      const { view } = await openCensusAt(47 * HOUR_MS, { date: DAY });
      passTime(HOUR_MS);
      expect(view.result.current.isDateLocked).toBe(true);

      // The computer's clock is corrected to an hour before the close and the day arrives again.
      vi.setSystemTime(midnight + 47 * HOUR_MS);
      view.rerender({ current: { date: DAY } });
      expect(view.result.current.isDateLocked).toBe(false);

      passTime(HOUR_MS);
      expect(view.result.current.isDateLocked).toBe(true);
      expect(vi.getTimerCount()).toBe(0);
    });

    it('locks on the next render after the 48 h while the timeout is still late', async () => {
      process.env.TZ = timezone;
      const record = { date: DAY };
      const { view } = await openCensusAt(47 * HOUR_MS + 50 * MINUTE_MS, record);

      vi.setSystemTime(
        clinicalWallClockToDate(DAY, '00:00').getTime() + 48 * HOUR_MS + 10 * MINUTE_MS
      );
      view.rerender({ current: record });
      expect(view.result.current.isDateLocked).toBe(true);
    });

    it('locks at once on focus after the computer slept past the 48 h', async () => {
      process.env.TZ = timezone;
      const { view } = await openCensusAt(47 * HOUR_MS, { date: DAY });

      vi.setSystemTime(clinicalWallClockToDate(DAY, '00:00').getTime() + 50 * HOUR_MS);
      act(() => {
        window.dispatchEvent(new Event('focus'));
      });
      expect(view.result.current.isDateLocked).toBe(true);
    });

    it('does not lock the next census day when the old day’s timeout was pending', async () => {
      process.env.TZ = timezone;
      const { view, renders } = await openCensusAt(47 * HOUR_MS + 50 * MINUTE_MS, { date: DAY });
      view.rerender({ current: { date: '2026-11-16' } });
      const rendersOnNewDay = renders();

      passTime(20 * MINUTE_MS);
      expect(view.result.current.isDateLocked).toBe(false);
      expect(renders()).toBe(rendersOnNewDay);
    });

    it('never locks for the administrator and sets no timeout', async () => {
      process.env.TZ = timezone;
      auth.role = 'admin';
      const { view, renders } = await openCensusAt(47 * HOUR_MS + 50 * MINUTE_MS, { date: DAY });
      const rendersWhenOpened = renders();
      expect(vi.getTimerCount()).toBe(0);

      passTime(HOUR_MS);
      expect(view.result.current.isDateLocked).toBe(false);
      expect(renders()).toBe(rendersWhenOpened);
    });

    it('never locks the census of today', async () => {
      process.env.TZ = timezone;
      // 10:00 in Rapa Nui on DAY; DAY stays the clinical day until 08:00 the next morning.
      const { view, renders } = await openCensusAt(10 * HOUR_MS, { date: DAY });
      const rendersWhenOpened = renders();

      passTime(21 * HOUR_MS + 59 * MINUTE_MS);
      expect(view.result.current.isDateLocked).toBe(false);
      expect(renders()).toBe(rendersWhenOpened);
    });

    it('waits without renders for a window that closes beyond the longest timeout', async () => {
      process.env.TZ = timezone;
      // 2027-03-01 closes about 108 days later, past the ~24.8 days setTimeout can wait.
      const { view, renders } = await openCensusAt(10 * HOUR_MS, { date: '2027-03-01' });
      const rendersWhenOpened = renders();
      // An unclamped delay would fire every millisecond and schedule itself again.
      const scheduled = vi.spyOn(globalThis, 'setTimeout');
      passTime(MINUTE_MS);
      expect(scheduled).not.toHaveBeenCalled();

      passTime(30 * 24 * HOUR_MS);
      expect(view.result.current.isDateLocked).toBe(false);
      expect(renders()).toBe(rendersWhenOpened);
      expect(vi.getTimerCount()).toBe(1);
    });

    it('opens an already closed day locked, with no timeout and no extra render', async () => {
      process.env.TZ = timezone;
      const { view, renders } = await openCensusAt(49 * HOUR_MS, { date: DAY });
      expect(view.result.current.isDateLocked).toBe(true);
      const rendersWhenOpened = renders();
      expect(vi.getTimerCount()).toBe(0);

      passTime(HOUR_MS);
      expect(renders()).toBe(rendersWhenOpened);
    });
  }
);
