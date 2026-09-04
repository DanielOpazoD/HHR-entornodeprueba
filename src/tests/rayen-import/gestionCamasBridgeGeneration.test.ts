// @vitest-environment node
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

import { describe, expect, it, vi } from 'vitest';

const contractSource = readFileSync(path.resolve('extension/message-contract.js'), 'utf8');
const bridgeGenerationSource = readFileSync(path.resolve('extension/bridge-generation.js'), 'utf8');
const bridgeHealthSource = readFileSync(
  path.resolve('extension/gestion-camas-bridge-health.js'),
  'utf8'
);
const relaySource = readFileSync(path.resolve('extension/content-gestioncamas.js'), 'utf8');
const injectSource = readFileSync(path.resolve('extension/inject-gestioncamas.js'), 'utf8');
const manifest = JSON.parse(readFileSync(path.resolve('extension/manifest.json'), 'utf8')) as {
  version: string;
};
const generation = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const flush = () => new Promise(resolve => setTimeout(resolve, 0));

type Listener = (event: { source: unknown; origin?: string; data: Record<string, unknown> }) => void;

const createRelay = (documentGeneration = '') => {
  const pageListeners: Listener[] = [];
  const pageRequests: Array<Record<string, unknown>> = [];
  const runtimeMessages: Array<Record<string, unknown>> = [];
  const attributes = new Map<string, string>();
  if (documentGeneration) attributes.set('data-hhr-extension-generation', documentGeneration);
  let runtimeListener:
    | ((message: Record<string, unknown>, sender: unknown, respond: (value: unknown) => void) => unknown)
    | null = null;
  const windowStub: Record<string, unknown> = {
    location: { origin: 'https://hospitalizado.rayensalud.cl' },
    addEventListener: (type: string, listener: Listener) => {
      if (type === 'message') pageListeners.push(listener);
    },
    removeEventListener: (_type: string, listener: Listener) => {
      const index = pageListeners.indexOf(listener);
      if (index >= 0) pageListeners.splice(index, 1);
    },
    postMessage: (message: Record<string, unknown>) => pageRequests.push(message),
  };
  const chromeRuntime = {
    getManifest: () => manifest,
    lastError: undefined,
    sendMessage: vi.fn((message: Record<string, unknown>, callback?: (value: unknown) => void) => {
      if (message.type === 'RAYEN_EXTENSION_RUNTIME_CONTEXT_REQUEST') {
        callback?.({ version: manifest.version, runtimeGeneration: generation });
      } else if (message.type === 'RAYEN_GC_DOCUMENT_READY') {
        callback?.({ connectionAttemptId: '' });
      } else {
        runtimeMessages.push(message);
        callback?.({ ok: true });
      }
    }),
    onMessage: {
      addListener: (listener: typeof runtimeListener) => {
        runtimeListener = listener;
      },
    },
  };
  const context = vm.createContext({
    window: windowStub,
    document: {
      documentElement: {
        getAttribute: (name: string) => attributes.get(name) || null,
        setAttribute: (name: string, value: string) => attributes.set(name, value),
      },
    },
    chrome: { runtime: chromeRuntime },
    setTimeout,
    clearTimeout,
    Date,
    Math,
    String,
    Number,
    Boolean,
    Object,
    Promise,
  });
  vm.runInContext('var globalThis = window; ' + contractSource, context);
  vm.runInContext(bridgeGenerationSource, context);
  vm.runInContext(bridgeHealthSource, context);
  vm.runInContext(relaySource, context);

  const answerBridge = (bridgeGeneration: string, injectVersion = manifest.version) => {
    const request = [...pageRequests].reverse().find(item =>
      item.type === 'RAYEN_GC_BRIDGE_STATUS_REQUEST'
    ) as { reqId: string };
    pageListeners.forEach(listener => listener({
      source: windowStub,
      data: {
        type: 'RAYEN_GC_BRIDGE_STATUS_RESULT',
        reqId: request.reqId,
        ready: true,
        injectVersion,
        bridgeGeneration,
      },
    }));
  };
  const ping = () => new Promise<Record<string, unknown>>(resolve => {
    runtimeListener?.({ type: 'RAYEN_EXTENSION_HEALTH_PING' }, {}, value => {
      resolve(value as Record<string, unknown>);
    });
  });
  const requestRuntime = (message: Record<string, unknown>) =>
    new Promise<Record<string, unknown>>(resolve => {
      runtimeListener?.(message, {}, value => resolve(value as Record<string, unknown>));
    });
  const answerLatest = (requestType: string, resultType: string, bridgeGeneration: string) => {
    const request = [...pageRequests].reverse().find(item => item.type === requestType) as {
      reqId: string;
    };
    pageListeners.forEach(listener => listener({
      source: windowStub,
      data: {
        type: resultType,
        reqId: request.reqId,
        injectVersion: manifest.version,
        bridgeGeneration,
        results: [],
      },
    }));
  };
  const announceSession = (bridgeGeneration: string) => {
    pageListeners.forEach(listener => listener({
      source: windowStub,
      origin: 'https://hospitalizado.rayensalud.cl',
      data: {
        type: 'RAYEN_GC_SESSION_CAPTURED',
        injectVersion: manifest.version,
        bridgeGeneration,
        info: { ['to' + 'ken']: 'not-forwarded-in-test' },
      },
    }));
  };
  return { ping, answerBridge, announceSession, requestRuntime, answerLatest, runtimeMessages };
};

describe('Gestión de Camas bridge generation', () => {
  it('declares the manifest version and requires a generation on every privileged request', () => {
    expect(injectSource).toContain(`const INJECT_VERSION = '${manifest.version}';`);
    expect(injectSource).toContain("if (!bridge.current) return;");
    expect(injectSource).toContain("d.type === 'RAYEN_GC_BRIDGE_STATUS_REQUEST'");
    expect(injectSource.indexOf('BRIDGE_REQUEST_TYPES.has(data && data.type)')).toBeLessThan(
      injectSource.indexOf('bridgeRuntime.contextFor(data)')
    );
  });

  it('accepts the current bridge and rejects the same-version bridge from an old lifecycle', async () => {
    const current = createRelay();
    const currentPing = current.ping();
    await flush();
    current.answerBridge(generation);
    await expect(currentPing).resolves.toMatchObject({ ready: true, reason: 'connected' });

    const stale = createRelay();
    const stalePing = stale.ping();
    await flush();
    stale.answerBridge('ffffffff-1111-4222-8333-444444444444');
    await expect(stalePing).resolves.toMatchObject({ ready: false, reason: 'outdated_tab' });
  });

  it('keeps the original document generation across a same-version extension reload', async () => {
    const oldGeneration = 'ffffffff-1111-4222-8333-444444444444';
    const stale = createRelay(oldGeneration);
    const stalePing = stale.ping();
    await flush();
    stale.answerBridge(oldGeneration);
    await expect(stalePing).resolves.toMatchObject({ ready: false, reason: 'outdated_tab' });
  });

  it('never forwards a token announcement from an old bridge generation', async () => {
    const relay = createRelay();
    relay.announceSession('ffffffff-1111-4222-8333-444444444444');
    await flush();
    expect(relay.runtimeMessages).toHaveLength(0);

    relay.announceSession(generation);
    await flush();
    expect(relay.runtimeMessages).toHaveLength(1);
    expect(relay.runtimeMessages[0]?.type).toBe('RAYEN_GC_SESSION_CAPTURED');
  });

  it('rejects privileged lookup results emitted by an old bridge generation', async () => {
    const relay = createRelay();
    const lookup = relay.requestRuntime({ type: 'RAYEN_GC_LOOKUP', runs: [] });
    await flush();
    relay.answerLatest(
      'RAYEN_GC_LOOKUP_REQUEST',
      'RAYEN_GC_LOOKUP_RESULT',
      'ffffffff-1111-4222-8333-444444444444'
    );
    await expect(lookup).resolves.toEqual({
      error: 'Abre una pestaña nueva de Gestión de Camas: la pestaña actual está desactualizada.',
    });
  });
});
