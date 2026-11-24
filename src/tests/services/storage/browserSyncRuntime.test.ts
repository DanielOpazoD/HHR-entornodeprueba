import { afterEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({
  owner: 'user',
  generation: null as string | null,
  admitted: null as string | null,
  epoch: 0,
}));
vi.mock('@/services/session/sessionOwnerKey', () => ({
  getStoredSessionOwnerKey: () => state.owner,
  hasSessionCleanupFailed: vi.fn(() => false),
  isSessionCleanupPending: vi.fn(() => false),
}));
vi.mock('@/services/session/sessionStorageTransition', () => ({
  getSessionGeneration: () => state.generation,
  getSessionOwner: () => state.admitted,
  getSessionEpoch: () => state.epoch,
}));
import { createBrowserSyncRuntime } from '@/services/storage/sync/browserSyncRuntime';

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.clearAllMocks();
  state.owner = 'user';
  state.generation = null;
  state.admitted = null;
  state.epoch = 0;
});

it('does not dispatch during bootstrap even if storage remembers the owner', () => {
  vi.useFakeTimers();
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
  const runtime = createBrowserSyncRuntime();
  const first = vi.fn();
  const second = vi.fn();
  runtime.onOnline(first);
  runtime.onOnline(second);
  window.dispatchEvent(new Event('online'));
  expect(first).not.toHaveBeenCalled();
  expect(second).not.toHaveBeenCalled();
  state.generation = 'admitted';
  window.dispatchEvent(new Event('online'));
  expect(first).toHaveBeenCalledTimes(1);
  expect(second).not.toHaveBeenCalled();
  state.generation = null;
  window.dispatchEvent(new Event('online'));
  expect(first).toHaveBeenCalledTimes(1);
});

it('does not dispatch while offline or without an owner', () => {
  vi.useFakeTimers();
  const online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
  state.generation = 'admitted';
  const wake = vi.fn();
  createBrowserSyncRuntime().onOnline(wake);
  window.dispatchEvent(new Event('online'));
  expect(wake).not.toHaveBeenCalled();
  online.mockReturnValue(true);
  state.owner = '';
  window.dispatchEvent(new Event('online'));
  expect(wake).not.toHaveBeenCalled();
});

it('does not wake nor act for anyone once another tab admitted someone else', () => {
  vi.useFakeTimers();
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
  const runtime = createBrowserSyncRuntime();
  const wake = vi.fn();
  runtime.onOnline(wake);
  state.generation = 'admitted';
  state.admitted = 'user';
  window.dispatchEvent(new Event('online'));
  expect(wake).toHaveBeenCalledTimes(1);
  expect(runtime.getOwnerKey()).toBe('user');
  // Another tab admits a different person on the shared key; this tab still holds `user`.
  state.owner = 'other';
  window.dispatchEvent(new Event('online'));
  expect(wake).toHaveBeenCalledTimes(1);
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
