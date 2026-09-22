// @vitest-environment node
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

import { describe, expect, it, vi } from 'vitest';

const bridgeSource = readFileSync(path.resolve('extension/bridge-generation-main.js'), 'utf8');
const recoverySource = readFileSync(path.resolve('extension/connection-relay-recovery.js'), 'utf8');
const gestionSource = readFileSync(path.resolve('extension/inject-gestioncamas.js'), 'utf8');
const manifest = JSON.parse(readFileSync(path.resolve('extension/manifest.json'), 'utf8')) as {
  version: string;
};
const generation = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

type PageMessage = Record<string, unknown>;
type PageListener = (event: { source: unknown; origin: string; data: PageMessage }) => unknown;

const createGestionWorld = (marker?: unknown) => {
  const listeners = new Set<PageListener>();
  const posts: PageMessage[] = [];
  const originalFetch = vi.fn(async () => ({ ok: true, json: async () => [] }));
  const windowObject: Record<string, unknown> = {
    location: {
      origin: 'https://hospitalizado.rayensalud.cl',
      pathname: '/',
      hash: '#/bed',
    },
    envConfig: {
      environment: { api_app: 'https://hospbackend.rayensalud.cl' },
    },
    fetch: originalFetch,
    addEventListener: (type: string, listener: PageListener) => {
      if (type === 'message') listeners.add(listener);
    },
    removeEventListener: (type: string, listener: PageListener) => {
      if (type === 'message') listeners.delete(listener);
    },
    postMessage: (message: PageMessage) => posts.push(message),
  };
  Object.defineProperty(windowObject, '__hhrExtensionRuntimeGenerationV1__', {
    value: generation,
    configurable: false,
    writable: false,
  });
  if (marker !== undefined) windowObject.__gcInjected = marker;

  function XMLHttpRequestMock() {}
  XMLHttpRequestMock.prototype.open = vi.fn();
  XMLHttpRequestMock.prototype.setRequestHeader = vi.fn();
  XMLHttpRequestMock.prototype.send = vi.fn();
  const context = vm.createContext({
    console,
    window: windowObject,
    localStorage: { getItem: () => '1342' },
    XMLHttpRequest: XMLHttpRequestMock,
    setTimeout: vi.fn(),
    clearTimeout: vi.fn(),
    URL,
    encodeURIComponent,
  });
  vm.runInContext(bridgeSource, context, { filename: 'bridge-generation-main.js' });
  vm.runInContext(recoverySource, context, { filename: 'connection-relay-recovery.js' });

  const run = (source = gestionSource) =>
    vm.runInContext(source, context, { filename: 'inject-gestioncamas.js' });
  const requestStatus = (reqId: string) => {
    for (const listener of [...listeners]) {
      listener({
        source: windowObject,
        origin: 'https://hospitalizado.rayensalud.cl',
        data: {
          type: 'RAYEN_GC_BRIDGE_STATUS_REQUEST',
          reqId,
          runtimeGeneration: generation,
        },
      });
    }
    return posts.findLast(message => message.reqId === reqId);
  };

  return {
    run,
    requestStatus,
    disconnect: () => listeners.clear(),
    listenerCount: () => listeners.size,
    currentFetch: () => windowObject.fetch,
    originalFetch,
  };
};

describe('MAIN bridge reactivation', () => {
  it('restores Gestión de Camas without wrapping fetch twice', () => {
    const world = createGestionWorld();
    world.run();
    const wrappedFetch = world.currentFetch();
    expect(wrappedFetch).not.toBe(world.originalFetch);

    world.disconnect();
    expect(world.listenerCount()).toBe(0);
    world.run();

    expect(world.listenerCount()).toBe(1);
    expect(world.currentFetch()).toBe(wrappedFetch);
    expect(world.requestStatus('reactivated-gc')).toMatchObject({
      reqId: 'reactivated-gc',
      ready: true,
      injectVersion: manifest.version,
    });
  });

  it('keeps an older reactivated closure honest about its package version', () => {
    const oldVersion = '0.48.29';
    const oldSource = gestionSource.replace(
      `const INJECT_VERSION = '${manifest.version}';`,
      `const INJECT_VERSION = '${oldVersion}';`
    );
    const world = createGestionWorld();
    world.run(oldSource);
    world.disconnect();
    world.run();

    expect(world.requestStatus('old-reactivated-gc')).toMatchObject({
      ready: true,
      injectVersion: oldVersion,
    });
  });

  it('does not pretend a legacy boolean marker can be repaired safely', () => {
    const world = createGestionWorld(true);
    world.run();

    expect(world.listenerCount()).toBe(0);
    expect(world.currentFetch()).toBe(world.originalFetch);
    expect(world.requestStatus('legacy-gc')).toBeUndefined();
  });
});
