import { afterEach, expect, it, vi } from 'vitest';
import {
  loadFunctionsModule,
  isFunctionsReloadRequired,
} from '@/services/firebase-runtime/functionsModuleLoader';

afterEach(() => vi.restoreAllMocks());
it('never requests the SDK while offline and keeps the existing retryable code', async () => {
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
  const imported = vi.fn(() => import('firebase/functions'));
  await expect(loadFunctionsModule(imported)).rejects.toMatchObject({
    code: 'functions/unavailable',
  });
  expect(imported).not.toHaveBeenCalled();
  expect(isFunctionsReloadRequired()).toBe(false);
});
it.each([
  'Failed to fetch dynamically imported module: /sdk.js',
  'error loading dynamically imported module: /sdk.js',
  'Importing a module script failed.',
  'Loading chunk 123 failed.',
  "'text/html' is not a valid JavaScript MIME type.",
])(
  'holds recovery for browser chunk failure %s and clears it after a successful import',
  async message => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
    await expect(
      loadFunctionsModule(() => Promise.reject(new TypeError(message)))
    ).rejects.toMatchObject({ code: 'functions/unavailable' });
    expect(isFunctionsReloadRequired()).toBe(true);
    await expect(loadFunctionsModule()).resolves.toBeDefined();
    expect(isFunctionsReloadRequired()).toBe(false);
  }
);
it('recognizes a named ChunkLoadError even without a browser-specific message', async () => {
  const error = Object.assign(new Error('Synthetic chunk unavailable'), { name: 'ChunkLoadError' });
  await expect(loadFunctionsModule(() => Promise.reject(error))).rejects.toMatchObject({
    code: 'functions/unavailable',
  });
  expect(isFunctionsReloadRequired()).toBe(true);
  await loadFunctionsModule();
  expect(isFunctionsReloadRequired()).toBe(false);
});
it('does not classify SDK evaluation errors as connectivity recovery', async () => {
  const error = new Error('Synthetic invalid SDK configuration');
  await expect(loadFunctionsModule(() => Promise.reject(error))).rejects.toBe(error);
  expect(isFunctionsReloadRequired()).toBe(false);
});
