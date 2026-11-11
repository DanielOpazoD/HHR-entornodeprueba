import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createRecoverableRuntimeLoader } from '@/services/runtime/createRecoverableRuntimeLoader';
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
  setModuleReloadRequired('audit', false);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
it('marks only a chunk failure repeated after confirmed connectivity and clears on success', async () => {
  const importer = vi.fn().mockRejectedValue(chunk());
  const load = createRecoverableRuntimeLoader('test-save', importer);
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
  const load = createRecoverableRuntimeLoader('test-save', importer);
  await expect(load()).rejects.toThrow();
  expect(fetch).not.toHaveBeenCalled();
  expect(getModuleReloadReason()).toBeNull();
  online.mockReturnValue(true);
  await expect(load()).resolves.toBe('ready');
  expect(getModuleReloadReason()).toBeNull();
});
it('recovers on the connected retry without marking a reload', async () => {
  const load = createRecoverableRuntimeLoader(
    'test-save',
    vi.fn().mockRejectedValueOnce(chunk()).mockResolvedValue('ready')
  );
  await expect(load()).resolves.toBe('ready');
  expect(getModuleReloadReason()).toBeNull();
});
it('does not mark non-chunk errors or an unconfirmed connection', async () => {
  await expect(
    createRecoverableRuntimeLoader('test-save', () => Promise.reject(new Error('database')))()
  ).rejects.toThrow('database');
  expect(fetch).not.toHaveBeenCalled();
  vi.mocked(fetch).mockRejectedValue(new Error('offline'));
  await expect(
    createRecoverableRuntimeLoader('test-save', () => Promise.reject(chunk()))()
  ).rejects.toThrow();
  expect(getModuleReloadReason()).toBeNull();
});

it('marks an audit failure with its own reason and clears it when a later import succeeds', async () => {
  const importer = vi.fn().mockRejectedValue(chunk());
  const load = createRecoverableRuntimeLoader('audit', importer);
  await expect(load()).rejects.toThrow();
  expect(getModuleReloadReason()).toBe('audit');
  importer.mockResolvedValue('ready');
  await expect(load()).resolves.toBe('ready');
  expect(getModuleReloadReason()).toBeNull();
});

it('keeps audit recovery silent offline or without verified connectivity', async () => {
  const online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
  const importer = vi.fn().mockRejectedValue(chunk());
  const load = createRecoverableRuntimeLoader('audit', importer);
  await expect(load()).rejects.toThrow();
  expect(fetch).not.toHaveBeenCalled();
  online.mockReturnValue(true);
  vi.mocked(fetch).mockResolvedValue({ ok: false } as Response);
  await expect(load()).rejects.toThrow();
  expect(getModuleReloadReason()).toBeNull();
  vi.mocked(fetch).mockResolvedValue({ ok: true } as Response);
  importer.mockRejectedValue(new Error('database'));
  await expect(load()).rejects.toThrow('database');
  expect(getModuleReloadReason()).toBeNull();
});

it('does not mark recovery if the retry is not a chunk error or the browser goes offline', async () => {
  const online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
  const importer = vi
    .fn()
    .mockRejectedValueOnce(chunk())
    .mockRejectedValueOnce(new Error('database'));
  await expect(createRecoverableRuntimeLoader('audit', importer)()).rejects.toThrow('database');
  expect(getModuleReloadReason()).toBeNull();
  importer.mockRejectedValueOnce(chunk()).mockImplementationOnce(() => {
    online.mockReturnValue(false);
    return Promise.reject(chunk());
  });
  await expect(createRecoverableRuntimeLoader('audit', importer)()).rejects.toThrow();
  expect(getModuleReloadReason()).toBeNull();
});
