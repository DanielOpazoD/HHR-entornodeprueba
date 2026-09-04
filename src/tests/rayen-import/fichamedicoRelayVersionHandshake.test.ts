// @vitest-environment node
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

import { describe, expect, it, vi } from 'vitest';

// El inject de mundo principal (inject-fichamedico.js) NO se reinyecta al recargar la
// extensión: una pestaña ya abierta conserva el lector anterior. Desde 0.48.8 cada
// respuesta del inject trae `injectVersion` y el relay (content-fichamedico.js) la
// compara con el manifest: un lector de otra versión no está listo ni lee.

const contractSource = readFileSync(path.resolve('extension/message-contract.js'), 'utf8');
const bridgeGenerationSource = readFileSync(path.resolve('extension/bridge-generation.js'), 'utf8');
const relaySource = readFileSync(path.resolve('extension/content-fichamedico.js'), 'utf8');
const injectSource = readFileSync(path.resolve('extension/inject-fichamedico.js'), 'utf8');
const manifest = JSON.parse(readFileSync(path.resolve('extension/manifest.json'), 'utf8')) as {
  version: string;
};

type Listener = (event: { source: unknown; data: Record<string, unknown> }) => void;

const createRelay = (installedVersion: string) => {
  const listeners: Listener[] = [];
  const requests: Array<Record<string, unknown>> = [];
  let onRuntimeMessage:
    | ((msg: Record<string, unknown>, sender: unknown, respond: (r: unknown) => void) => unknown)
    | null = null;
  const windowStub: Record<string, unknown> = {
    location: { origin: 'https://fichamedico.rayensalud.cl' },
    addEventListener: (type: string, listener: Listener) => {
      if (type === 'message') listeners.push(listener);
    },
    removeEventListener: (_type: string, listener: Listener) => {
      const index = listeners.indexOf(listener);
      if (index >= 0) listeners.splice(index, 1);
    },
    postMessage: (data: Record<string, unknown>) => {
      requests.push(data);
    },
  };
  const context = vm.createContext({
    window: windowStub,
    document: { documentElement: { setAttribute: () => undefined } },
    chrome: {
      runtime: {
        getManifest: () => ({ version: installedVersion }),
        onMessage: {
          addListener: (fn: typeof onRuntimeMessage) => {
            onRuntimeMessage = onRuntimeMessage || fn;
          },
        },
        sendMessage: vi.fn((_message, callback) => callback({
          version: installedVersion,
          runtimeGeneration: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
        })),
        lastError: undefined,
      },
    },
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
  vm.runInContext(relaySource, context);

  /** Responde al ÚLTIMO request del relay como lo haría el inject. */
  const answerFromInject = (
    payload: Record<string, unknown>,
    bridgeGeneration = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'
  ) => {
    const request = requests[requests.length - 1] as { reqId: string; type: string };
    const type = String(request.type).replace(/_REQUEST$/, '_RESULT');
    for (const listener of [...listeners]) {
      listener({
        source: windowStub,
        data: {
          type,
          reqId: request.reqId,
          bridgeGeneration,
          ...payload,
        },
      });
    }
  };

  const send = (msg: Record<string, unknown>) =>
    new Promise<Record<string, unknown>>(resolve => {
      onRuntimeMessage?.(msg, {}, response => resolve(response as Record<string, unknown>));
    });

  return { send, answerFromInject, requests };
};

const flush = () => new Promise(resolve => setTimeout(resolve, 0));

describe('relay de Ficha Médico · versión del inject', () => {
  it('el inject declara la misma versión que el manifest (una constante, no chrome.runtime)', () => {
    expect(injectSource).toContain(`const INJECT_VERSION = '${manifest.version}';`);
  });

  it('un inject de la misma versión pasa la salud y la lectura tal cual', async () => {
    const relay = createRelay('0.48.8');
    const ping = relay.send({ type: 'RAYEN_EXTENSION_HEALTH_PING' });
    await flush();
    relay.answerFromInject({
      injectVersion: '0.48.8',
      ready: true,
      identity: { fullName: 'Daniel Opazo', role: 'Médico' },
      expiresAt: 1_788_445_690_306,
      remainingSeconds: 67_718,
      message: 'Ficha Médico disponible. Sesión clínica vigente.',
    });
    await expect(ping).resolves.toEqual({
      ready: true,
      reason: 'connected',
      bridgeVersion: '0.48.8',
      bridgeGeneration: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
      identity: { fullName: 'Daniel Opazo', role: 'Médico' },
      expiresAt: 1_788_445_690_306,
      remainingSeconds: 67_718,
      message: 'Ficha Médico disponible. Sesión clínica vigente.',
    });

    const read = relay.send({ type: 'RAYEN_READ' });
    await flush();
    relay.answerFromInject({ injectVersion: '0.48.8', snapshot: { encounters: [] } });
    await expect(read).resolves.toEqual({ snapshot: { encounters: [] } });
  });

  it('rechaza una respuesta de la misma versión que conserva una generación anterior', async () => {
    const oldGeneration = 'ffffffff-1111-4222-8333-444444444444';
    const relay = createRelay(manifest.version);
    const ping = relay.send({ type: 'RAYEN_EXTENSION_HEALTH_PING' });
    await flush();
    expect(relay.requests.at(-1)?.runtimeGeneration).toBe(
      'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'
    );
    relay.answerFromInject({ injectVersion: manifest.version, ready: true }, oldGeneration);
    await expect(ping).resolves.toMatchObject({ ready: false, reason: 'outdated_tab' });
  });

  it('un inject de otra versión (o sin versión) no está listo y no lee: pide recargar la pestaña', async () => {
    const relay = createRelay('0.48.8');
    const ping = relay.send({ type: 'RAYEN_EXTENSION_HEALTH_PING' });
    await flush();
    relay.answerFromInject({
      ready: true,
      identity: { fullName: 'Daniel Opazo', role: 'Médico' },
      message: 'Ficha Médico disponible. Sesión clínica vigente.',
    });
    const health = await ping;
    expect(health.ready).toBe(false);
    expect(health.message).toContain('versión o generación anterior de la extensión');
    // El relay conserva la identidad verificada (probeTabs solo la usa en respuestas listas).
    expect(health.identity).toEqual({ fullName: 'Daniel Opazo', role: 'Médico' });

    const read = relay.send({ type: 'RAYEN_READ' });
    await flush();
    relay.answerFromInject({ injectVersion: '0.48.5', snapshot: { encounters: [] } });
    const result = await read;
    expect(result.snapshot).toBeUndefined();
    expect(String(result.error)).toContain('versión o generación anterior de la extensión');

    // Una respuesta inválida se rechaza, pero no envenena permanentemente el relé.
    const requestsBefore = relay.requests.length;
    const nextInfo = relay.send({ type: 'RAYEN_FM_GET_FETCH_INFO' });
    await flush();
    relay.answerFromInject({ injectVersion: '0.48.5' });
    await expect(nextInfo).resolves.toEqual({
      error: expect.stringContaining('versión o generación anterior de la extensión'),
    });
    const nextRead = relay.send({ type: 'RAYEN_READ' });
    await flush();
    relay.answerFromInject({ injectVersion: '0.48.5' });
    await expect(nextRead).resolves.toEqual({
      error: expect.stringContaining('versión o generación anterior de la extensión'),
    });
    expect(relay.requests).toHaveLength(requestsBefore + 2);
  });

  it('rechaza la misma versión cuando pertenece a una generación anterior de la extensión', async () => {
    const relay = createRelay('0.48.10');
    const ping = relay.send({ type: 'RAYEN_EXTENSION_HEALTH_PING' });
    await flush();
    relay.answerFromInject(
      {
        injectVersion: '0.48.10',
        ready: true,
        message: 'Pestaña antigua que todavía responde.',
      },
      'ffffffff-1111-4222-8333-444444444444'
    );

    await expect(ping).resolves.toMatchObject({
      ready: false,
      reason: 'outdated_tab',
      bridgeVersion: '0.48.10',
    });
  });

  it('un fetch-info de un inject de otra versión se rechaza (primera detección por esa vía)', async () => {
    const relay = createRelay('0.48.8');
    const info = relay.send({ type: 'RAYEN_FM_GET_FETCH_INFO' });
    await flush();
    relay.answerFromInject({ injectVersion: '0.48.5', info: { apiOrigin: 'https://x' } });
    await expect(info).resolves.toEqual({
      error: expect.stringContaining('versión o generación anterior de la extensión'),
    });
  });

  it('un tiempo de espera agotado no se confunde con un lector obsoleto', async () => {
    vi.useFakeTimers();
    try {
      const relay = createRelay('0.48.8');
      const ping = relay.send({ type: 'RAYEN_EXTENSION_HEALTH_PING' });
      await vi.advanceTimersByTimeAsync(4_100);
      const health = await ping;
      expect(health.ready).toBe(false);
      expect(health.message).not.toContain('versión anterior');
    } finally {
      vi.useRealTimers();
    }
  });
});
