import { afterEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({
  owner: 'user',
  generation: null as string | null,
  admitted: null as string | null,
  epoch: 0,
}));
vi.mock('@/services/storage/sessionOwnerKey', () => ({
  getStoredSessionOwnerKey: () => state.owner,
  hasSessionCleanupFailed: vi.fn(() => false),
  isSessionCleanupPending: vi.fn(() => false),
}));
vi.mock('@/services/storage/sessionStorageTransition', () => ({
  getSessionGeneration: () => state.generation,
  getSessionOwner: () => state.admitted,
  getSessionEpoch: () => state.epoch,
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
  state.admitted = null;
  state.epoch = 0;
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
it('does not wake nor act for anyone once another tab admitted someone else', () => {
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
  const runtime = createBrowserSyncRuntime();
  runtime.onOnline(vi.fn());
  state.generation = 'admitted';
  state.admitted = 'user';
  expect(h.allowed!()).toBe(true);
  expect(runtime.getOwnerKey()).toBe('user');
  // Another tab admits a different person on the shared key; this tab still holds `user`.
  state.owner = 'other';
  expect(h.allowed!()).toBe(false);
  expect(runtime.getOwnerKey()).toBeNull();
});
it('acts for nobody in a document that logged out, while another tab holds the browser', () => {
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
  const runtime = createBrowserSyncRuntime();
  // This document admitted someone earlier (epoch > 0) and logged out; another tab admitted `other`.
  state.epoch = 2;
  state.generation = null;
  state.admitted = null;
  state.owner = 'other';
  expect(runtime.getOwnerKey()).toBeNull();
});
