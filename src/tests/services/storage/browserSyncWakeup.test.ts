import { afterEach, expect, it, vi } from 'vitest';
import {
  startBrowserSyncWakeup,
  SYNC_QUEUE_WAKE_INTERVAL_MS,
} from '@/services/storage/sync/browserSyncWakeup';
let stop: (() => void) | undefined;
afterEach(() => {
  stop?.();
  vi.useRealTimers();
  vi.restoreAllMocks();
});
it('wakes a persisted or delayed retry without requiring another edit or online transition', async () => {
  vi.useFakeTimers();
  const wake = vi.fn();
  stop = startBrowserSyncWakeup(wake, () => true);
  await vi.advanceTimersByTimeAsync(0);
  expect(wake).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(SYNC_QUEUE_WAKE_INTERVAL_MS);
  expect(wake).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(SYNC_QUEUE_WAKE_INTERVAL_MS);
  expect(wake).toHaveBeenCalledTimes(3);
});
it('reevaluates connection/session on every wake and stops all callbacks on disposal', async () => {
  vi.useFakeTimers();
  let eligible = false;
  const wake = vi.fn();
  stop = startBrowserSyncWakeup(wake, () => eligible);
  await vi.advanceTimersByTimeAsync(SYNC_QUEUE_WAKE_INTERVAL_MS);
  window.dispatchEvent(new Event('online'));
  expect(wake).not.toHaveBeenCalled();
  eligible = true;
  window.dispatchEvent(new Event('focus'));
  expect(wake).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(SYNC_QUEUE_WAKE_INTERVAL_MS);
  expect(wake).toHaveBeenCalledTimes(2);
  eligible = false;
  await vi.advanceTimersByTimeAsync(SYNC_QUEUE_WAKE_INTERVAL_MS);
  expect(wake).toHaveBeenCalledTimes(2);
  stop();
  eligible = true;
  window.dispatchEvent(new Event('online'));
  window.dispatchEvent(new Event('focus'));
  await vi.advanceTimersByTimeAsync(SYNC_QUEUE_WAKE_INTERVAL_MS);
  expect(wake).toHaveBeenCalledTimes(2);
});
