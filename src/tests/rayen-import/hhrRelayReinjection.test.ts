// @vitest-environment node
import fs from 'node:fs';
import vm from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

const ORIGIN = 'https://hhr-hospitalizados.app';

const installTwice = (file: string) => {
  const source = fs.readFileSync(`extension/${file}`, 'utf8');
  const listeners = new Set<(event: unknown) => void>();
  const sendMessage = vi.fn(() => new Promise(() => undefined));
  const windowObject = {
    location: { origin: ORIGIN },
    addEventListener: (type: string, listener: (event: unknown) => void) => {
      if (type === 'message') listeners.add(listener);
    },
    removeEventListener: (type: string, listener: (event: unknown) => void) => {
      if (type === 'message') listeners.delete(listener);
    },
    postMessage: vi.fn(),
  };
  const types = new Proxy({}, { get: (_target, name) => String(name) });
  const context = vm.createContext({
    window: windowObject,
    chrome: {
      runtime: {
        id: 'current-extension',
        sendMessage,
        getManifest: () => ({ version: '0.0.0' }),
        onMessage: { addListener: vi.fn(), removeListener: vi.fn() },
      },
    },
    console,
    HhrAppOrigins: new Set([ORIGIN]),
    HhrRayenMessageContract: { types },
  });
  vm.runInContext(source, context, { filename: file });
  vm.runInContext(source, context, { filename: file });
  return { listeners, sendMessage, windowObject };
};

describe('reinjecting the HHR page relays after the extension worker restarts', () => {
  it.each([
    'content-hhr-sync-bundle.js',
    'content-hhr-patient-flow.js',
    'content-hhr-epicrisis.js',
    'content-hhr-patient-documents.js',
    'content-hhr-statistical-discharge.js',
    'content-hhr-statistical-evidence.js',
    'content-hhr-syslab.js',
  ])('%s keeps a single page listener', file => {
    expect(installTwice(file).listeners.size).toBe(1);
  });

  it('starts one census capture per request after a reinjection', () => {
    const { listeners, sendMessage, windowObject } = installTwice('content-hhr-sync-bundle.js');
    listeners.forEach(listener =>
      listener({
        source: windowObject,
        origin: ORIGIN,
        data: {
          type: 'HHR_RAYEN_REQUEST_SYNC_BUNDLE',
          requestId: 'sintetico',
          dateStart: '2026-10-31',
          dateEnd: '2026-11-01',
        },
      })
    );
    expect(sendMessage).toHaveBeenCalledOnce();
  });
});
