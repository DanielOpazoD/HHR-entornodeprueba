// @vitest-environment node
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

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
