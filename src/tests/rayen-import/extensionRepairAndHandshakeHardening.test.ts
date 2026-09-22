// @vitest-environment node
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import '../../../extension/bridge-generation.js';

/**
 * Tres endurecimientos de la extensión que salieron de la revisión del 10-09:
 *  1. La reparación de conexión debe sondear las pestañas que acaba de abrir, no la caché de 3 s.
 *  2. El handshake de generación reintenta si el service worker estaba dormido en document_start.
 *  3. Los hooks `RAYEN_*_TEST_*` que permitían a cualquier script de la página disparar descargas
 *     y guardados privilegiados ya no existen en producción.
 */

const read = (file: string) => fs.readFileSync(path.resolve('extension', file), 'utf8');

type Relay = {
  context: Promise<{ runtimeGeneration: string } | null>;
  getContext: () => Promise<{ runtimeGeneration: string } | null>;
  isCurrent: (data: Record<string, unknown>, runtimeGeneration: string) => boolean;
};
type BridgeGeneration = {
  createRelay: (input: Record<string, unknown>) => Relay;
};
const bridge = (globalThis as typeof globalThis & { HhrBridgeGeneration: BridgeGeneration })
  .HhrBridgeGeneration;

const createChrome = (responses: Array<{ runtimeGeneration: string } | null>) => {
  let lastError: { message: string } | undefined;
  const sendMessage = vi.fn((_message: unknown, callback: (value: unknown) => void) => {
    const next = responses.shift();
    lastError = next
      ? undefined
      : { message: 'Could not establish connection. Receiving end does not exist.' };
    callback(next ?? undefined);
  });
  return {
    runtime: {
      sendMessage,
      get lastError() {
        return lastError;
      },
    },
  };
};

describe('generation handshake retries while the service worker wakes up', () => {
  afterEach(() => vi.useRealTimers());

  it('recovers after exhausted startup attempts and coalesces concurrent callers', async () => {
    let now = 0;
    const chromeApi = createChrome([null, null, null, { runtimeGeneration: 'recovered' }]);
    const relay = bridge.createRelay({
      chromeApi,
      runtimeMessages: {},
      extensionVersion: 'test',
      delay: async () => undefined,
      now: () => now,
    });
    await expect(relay.context).resolves.toBeNull();
    await expect(relay.getContext()).resolves.toBeNull();
    expect(chromeApi.runtime.sendMessage).toHaveBeenCalledTimes(3);
    now = 1000;
    const first = relay.getContext();
    expect(relay.getContext()).toBe(first);
    await expect(first).resolves.toEqual({ runtimeGeneration: 'recovered' });
    await expect(relay.getContext()).resolves.toEqual({ runtimeGeneration: 'recovered' });
    expect(chromeApi.runtime.sendMessage).toHaveBeenCalledTimes(4);
  });

  it('notifies the relay when a later health request finally obtains the context', async () => {
    let now = 0;
    const onContext = vi.fn();
    const relay = bridge.createRelay({
      chromeApi: createChrome([null, { runtimeGeneration: 'late-worker' }]),
      runtimeMessages: {},
      extensionVersion: 'test',
      maxAttempts: 1,
      recoveryDelayMs: 100,
      now: () => now,
      onContext,
    });
    await expect(relay.context).resolves.toBeNull();
    expect(onContext).not.toHaveBeenCalled();
    now = 100;
    await expect(relay.getContext()).resolves.toEqual({ runtimeGeneration: 'late-worker' });
    await Promise.resolve();
    expect(onContext).toHaveBeenCalledExactlyOnceWith({ runtimeGeneration: 'late-worker' });
    await relay.getContext();
    expect(onContext).toHaveBeenCalledTimes(1);
  });

  it('bounds a missing callback and ignores a late reply from a timed-out attempt', async () => {
    vi.useFakeTimers();
    const callbacks: Array<(value: unknown) => void> = [];
    const chromeApi = { runtime: { sendMessage: vi.fn((_m, cb) => callbacks.push(cb)) } };
    const relay = bridge.createRelay({
      chromeApi,
      runtimeMessages: {},
      maxAttempts: 1,
      requestTimeoutMs: 100,
      recoveryDelayMs: 100,
    });
    await vi.advanceTimersByTimeAsync(100);
    await expect(relay.context).resolves.toBeNull();
    await vi.advanceTimersByTimeAsync(100);
    const retry = relay.getContext();
    callbacks[0]({ runtimeGeneration: 'late' });
    callbacks[1]({ runtimeGeneration: 'current' });
    await expect(retry).resolves.toEqual({ runtimeGeneration: 'current' });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('ignores a callback delivered after Chrome invalidates the old extension runtime', async () => {
    let callback: ((value: unknown) => void) | undefined;
    const runtime = {
      sendMessage: vi.fn((_message: unknown, next: (value: unknown) => void) => {
        callback = next;
      }),
      get lastError(): undefined {
        throw new Error('Extension context invalidated.');
      },
    };
    const relay = bridge.createRelay({
      chromeApi: { runtime },
      runtimeMessages: {
        EXTENSION_RUNTIME_CONTEXT_REQUEST: 'RAYEN_EXTENSION_RUNTIME_CONTEXT_REQUEST',
      },
      extensionVersion: '0.48.27',
      maxAttempts: 1,
    });

    expect(() => callback?.({ runtimeGeneration: 'stale' })).not.toThrow();
    await expect(relay.context).resolves.toBeNull();
  });

  it('resolves with the context obtained on a later attempt', async () => {
    const chromeApi = createChrome([null, null, { runtimeGeneration: 'gen-b' }]);
    const delay = vi.fn(async (_ms: number) => undefined);
    const relay = bridge.createRelay({
      chromeApi,
      runtimeMessages: {
        EXTENSION_RUNTIME_CONTEXT_REQUEST: 'RAYEN_EXTENSION_RUNTIME_CONTEXT_REQUEST',
      },
      extensionVersion: '0.48.19',
      delay,
    });

    await expect(relay.context).resolves.toEqual({ runtimeGeneration: 'gen-b' });
    expect(chromeApi.runtime.sendMessage).toHaveBeenCalledTimes(3);
    // Backoff grows with the attempt: 250 ms, then 500 ms.
    expect(delay.mock.calls.map(call => call[0])).toEqual([250, 500]);
  });

  it('gives up after the bounded attempts and reports no context', async () => {
    const chromeApi = createChrome([null, null, null, null]);
    const relay = bridge.createRelay({
      chromeApi,
      runtimeMessages: {
        EXTENSION_RUNTIME_CONTEXT_REQUEST: 'RAYEN_EXTENSION_RUNTIME_CONTEXT_REQUEST',
      },
      extensionVersion: '0.48.19',
      maxAttempts: 2,
      delay: async () => undefined,
    });

    await expect(relay.context).resolves.toBeNull();
    expect(chromeApi.runtime.sendMessage).toHaveBeenCalledTimes(2);
  });
});

describe('compatible extension updates keep existing MAIN readers connected', () => {
  it.each(['0.48.25', '0.48.26'])(
    'accepts pre-protocol reader %s only with the same browser-session generation',
    legacyVersion => {
      const relay = bridge.createRelay({
        chromeApi: createChrome([]),
        runtimeMessages: {},
        extensionVersion: '0.48.27',
      });

      expect(
        relay.isCurrent(
          {
            injectVersion: legacyVersion,
            bridgeGeneration: 'generation-current',
          },
          'generation-current'
        )
      ).toBe(true);
      expect(
        relay.isCurrent(
          {
            injectVersion: legacyVersion,
            bridgeGeneration: 'generation-old',
          },
          'generation-current'
        )
      ).toBe(false);
    }
  );

  it('uses the bridge protocol after migration and rejects unknown legacy readers', () => {
    const relay = bridge.createRelay({
      chromeApi: createChrome([]),
      runtimeMessages: {},
      extensionVersion: '0.48.28',
    });

    expect(
      relay.isCurrent(
        {
          injectVersion: '0.48.27',
          bridgeProtocolVersion: 1,
          bridgeGeneration: 'generation-current',
        },
        'generation-current'
      )
    ).toBe(true);
    expect(
      relay.isCurrent(
        {
          injectVersion: '0.48.24',
          bridgeGeneration: 'generation-current',
        },
        'generation-current'
      )
    ).toBe(false);
  });
});

describe('connection repair probes the freshly opened tabs', () => {
  it('bypasses the short health cache and forwards the tab ids', () => {
    const background = read('background.js');
    expect(background).toContain('readHealth: targets => readExtensionHealthUncached(targets),');
    expect(background).not.toMatch(
      /HhrConnectionRepairRuntime\.create\(\{[^}]*readHealth: handleExtensionHealth/s
    );
  });
});

describe('no page-triggered privileged diagnostics in production', () => {
  it.each(['content-fichamedico.js', 'content-gestioncamas.js'])(
    '%s has no RAYEN_*_TEST_* hooks',
    file => {
      expect(read(file)).not.toMatch(/RAYEN_(FM|GC)_TEST_/);
    }
  );
});

describe('release checker keeps both MAIN-world injects in lockstep with the manifest', () => {
  it('validates inject-gestioncamas.js as well as inject-fichamedico.js', () => {
    const checker = fs.readFileSync(
      path.resolve('scripts/check-rayen-extension-release.mjs'),
      'utf8'
    );
    expect(checker).toContain("'inject-gestioncamas.js'");
    expect(checker).toContain('inject-gestioncamas.js declara INJECT_VERSION');
    const manifest = JSON.parse(read('manifest.json')) as { version: string };
    expect(read('inject-gestioncamas.js')).toContain(
      `const INJECT_VERSION = '${manifest.version}';`
    );
  });
});
