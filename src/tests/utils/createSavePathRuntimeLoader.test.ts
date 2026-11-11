import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createSavePathRuntimeLoader } from '@/services/runtime/createSavePathRuntimeLoader';
import {
  getModuleReloadReason,
  setModuleReloadRequired,
} from '@/services/runtime/moduleReloadRecovery';
const chunk = () => new TypeError('Failed to fetch dynamically imported module');
beforeEach(() => {
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));
});
afterEach(() => {
  setModuleReloadRequired('test-save', false);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
it('marks only a chunk failure repeated after confirmed connectivity and clears on success', async () => {
  const importer = vi.fn().mockRejectedValue(chunk());
  const load = createSavePathRuntimeLoader('test-save', importer);
  await expect(load()).rejects.toThrow();
  expect(fetch).toHaveBeenCalled();
  expect(importer).toHaveBeenCalledTimes(2);
  expect(getModuleReloadReason()).toBe('save');
  importer.mockResolvedValue('ready');
  await expect(load()).resolves.toBe('ready');
  expect(getModuleReloadReason()).toBeNull();
});
it('retries silently offline then recovers without a notice when import works', async () => {
  const online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
  const importer = vi.fn().mockRejectedValueOnce(chunk()).mockResolvedValue('ready');
  const load = createSavePathRuntimeLoader('test-save', importer);
  await expect(load()).rejects.toThrow();
  expect(fetch).not.toHaveBeenCalled();
  expect(getModuleReloadReason()).toBeNull();
  online.mockReturnValue(true);
  await expect(load()).resolves.toBe('ready');
  expect(getModuleReloadReason()).toBeNull();
});
it('recovers on the connected retry without marking a reload', async () => {
  const load = createSavePathRuntimeLoader(
    'test-save',
    vi.fn().mockRejectedValueOnce(chunk()).mockResolvedValue('ready')
  );
  await expect(load()).resolves.toBe('ready');
  expect(getModuleReloadReason()).toBeNull();
});
it('does not mark non-chunk errors or an unconfirmed connection', async () => {
  await expect(
    createSavePathRuntimeLoader('test-save', () => Promise.reject(new Error('database')))()
  ).rejects.toThrow('database');
  expect(fetch).not.toHaveBeenCalled();
  vi.mocked(fetch).mockRejectedValue(new Error('offline'));
  await expect(
    createSavePathRuntimeLoader('test-save', () => Promise.reject(chunk()))()
  ).rejects.toThrow();
  expect(getModuleReloadReason()).toBeNull();
});
