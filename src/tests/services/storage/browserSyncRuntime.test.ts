import { afterEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ owner: 'user', generation: null as string | null }));
vi.mock('@/services/storage/sessionOwnerKey', () => ({
  getStoredSessionOwnerKey: () => state.owner,
  hasSessionCleanupFailed: vi.fn(() => false),
  isSessionCleanupPending: vi.fn(() => false),
}));
vi.mock('@/services/storage/sessionStorageTransition', () => ({
  getSessionGeneration: () => state.generation,
}));
const h = vi.hoisted(() => ({
  wake: undefined as (() => void) | undefined,
  allowed: undefined as (() => boolean) | undefined,
  start: vi.fn(),
}));
vi.mock('@/services/storage/sync/browserSyncWakeup', () => ({
  startBrowserSyncWakeup: (wake: () => void, allowed: () => boolean) => {
    h.wake = wake;
    h.allowed = allowed;
    h.start();
    return () => {};
  },
}));
import { createBrowserSyncRuntime } from '@/services/storage/sync/browserSyncRuntime';
afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  state.owner = 'user';
  state.generation = null;
});
it('does not dispatch during bootstrap even if storage remembers the owner', () => {
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
  const runtime = createBrowserSyncRuntime();
  runtime.onOnline(vi.fn());
  runtime.onOnline(vi.fn());
  expect(h.start).toHaveBeenCalledTimes(1);
  expect(h.allowed!()).toBe(false);
  state.generation = 'admitted';
  expect(h.allowed!()).toBe(true);
  state.generation = null;
  expect(h.allowed!()).toBe(false);
});
it('does not dispatch while offline or without an owner', () => {
  const online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
  state.generation = 'admitted';
  createBrowserSyncRuntime().onOnline(vi.fn());
  expect(h.allowed!()).toBe(false);
  online.mockReturnValue(true);
  state.owner = '';
  expect(h.allowed!()).toBe(false);
});
