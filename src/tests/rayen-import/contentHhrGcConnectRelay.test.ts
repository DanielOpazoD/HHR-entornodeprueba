// @vitest-environment node
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

import { describe, expect, it, vi } from 'vitest';

const contentBridgeSource = readFileSync(path.resolve('extension/content-hhr.js'), 'utf8');
const repairBridgeSource = readFileSync(
  path.resolve('extension/content-hhr-connection-repair.js'),
  'utf8'
);
const bridgeGenerationSource = readFileSync(path.resolve('extension/bridge-generation.js'), 'utf8');

type PageMessage = { source: unknown; data: Record<string, unknown>; origin?: string };

const createHarness = (
  sendMessage: (message: Record<string, unknown>) => Promise<unknown>,
  { userActive = true }: { userActive?: boolean } = {}
) => {
  const pageListeners: Array<(event: PageMessage) => void> = [];
  let onRuntimeMessage:
    | ((
        message: Record<string, unknown>,
        sender: unknown,
        respond: (value: unknown) => void
      ) => unknown)
    | undefined;
  const postMessage = vi.fn();
  const windowObject = {
    location: { origin: 'http://localhost:3001' },
    addEventListener: vi.fn((type: string, listener: (event: PageMessage) => void) => {
      if (type === 'message') pageListeners.push(listener);
    }),
    postMessage,
  };
  const context = vm.createContext({
    window: windowObject,
    navigator: { userActivation: { isActive: userActive } },
    chrome: {
      runtime: {
        sendMessage: (message: Record<string, unknown>, callback?: (value: unknown) => void) => {
          if (message.type === 'RAYEN_EXTENSION_RUNTIME_CONTEXT_REQUEST') {
            callback?.({
              version: '0.48.10',
              runtimeGeneration: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
            });
            return undefined;
          }
          return sendMessage(message);
        },
        getManifest: () => ({ version: '0.48.10' }),
        lastError: undefined,
        onMessage: {
          addListener: vi.fn(listener => {
            onRuntimeMessage = listener;
          }),
        },
      },
    },
    console,
    HhrRayenMessageContract: {
      types: {
        EXTENSION_RUNTIME_CONTEXT_REQUEST: 'RAYEN_EXTENSION_RUNTIME_CONTEXT_REQUEST',
        GC_CONNECT_REQUEST: 'RAYEN_GC_CONNECT_REQUEST',
        CONNECTION_REPAIR_REQUEST: 'RAYEN_CONNECTION_REPAIR_REQUEST',
      },
    },
  });
  vm.runInContext(bridgeGenerationSource, context, { filename: 'bridge-generation.js' });
  vm.runInContext(repairBridgeSource, context, {
    filename: 'content-hhr-connection-repair.js',
  });
  vm.runInContext(contentBridgeSource, context, { filename: 'content-hhr.js' });
  return {
    onMessage: (event: PageMessage) =>
      pageListeners.forEach(listener =>
        listener({ origin: windowObject.location.origin, ...event })
      ),
    onRuntimeMessage,
    postMessage,
    windowObject,
  };
};

describe('content-hhr · relé de conexión de Gestión de Camas', () => {
  it('traduce la petición de la página al runtime y devuelve el resultado', async () => {
    const sendMessage = vi.fn(async () => ({ ok: true }));
    const { onMessage, postMessage, windowObject } = createHarness(sendMessage);

    onMessage?.({
      source: windowObject,
      data: { type: 'HHR_RAYEN_GC_CONNECT_REQUEST', reqId: 'req-1', renew: true },
    });
    await vi.waitFor(() =>
      expect(postMessage).toHaveBeenCalledWith(
        { type: 'HHR_RAYEN_GC_CONNECT_RESULT', reqId: 'req-1', ok: true, error: undefined },
        'http://localhost:3001'
      )
    );
    expect(sendMessage).toHaveBeenCalledWith({ type: 'RAYEN_GC_CONNECT_REQUEST', renew: true });
  });

  it('degrada con ok:false cuando el runtime rechaza', async () => {
    const sendMessage = vi.fn(async () => {
      throw new Error('sin worker');
    });
    const { onMessage, postMessage, windowObject } = createHarness(sendMessage);

    onMessage?.({
      source: windowObject,
      data: { type: 'HHR_RAYEN_GC_CONNECT_REQUEST', reqId: 'req-2' },
    });
    await vi.waitFor(() =>
      expect(postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'HHR_RAYEN_GC_CONNECT_RESULT',
          reqId: 'req-2',
          ok: false,
          error: expect.stringContaining('sin worker'),
        }),
        'http://localhost:3001'
      )
    );
  });

  it('reutiliza la reparación limpia del runtime y conserva la correlación de la página', async () => {
    const report = { version: '0.48.12', checkedAt: '2026-09-04T12:00:00.000Z' };
    const sendMessage = vi.fn(async () => ({
      ok: false,
      state: 'needs-login',
      requiresLogin: true,
      message: 'Completa el acceso.',
      report,
    }));
    const { onMessage, postMessage, windowObject } = createHarness(sendMessage);

    onMessage?.({
      source: windowObject,
      data: { type: 'HHR_RAYEN_CONNECTION_REPAIR_REQUEST', reqId: 'repair-1' },
    });
    await vi.waitFor(() =>
      expect(postMessage).toHaveBeenCalledWith(
        {
          type: 'HHR_RAYEN_CONNECTION_REPAIR_RESULT',
          reqId: 'repair-1',
          ok: false,
          state: 'needs-login',
          message: 'Completa el acceso.',
          error: undefined,
          requiresLogin: true,
          report,
        },
        'http://localhost:3001'
      )
    );
    expect(sendMessage).toHaveBeenCalledWith({ type: 'RAYEN_CONNECTION_REPAIR_REQUEST' });
  });

  it('degrada la reparación a error sin abrir pestañas desde la aplicación', async () => {
    const sendMessage = vi.fn(async () => {
      throw new Error('contexto invalidado');
    });
    const { onMessage, postMessage, windowObject } = createHarness(sendMessage);

    onMessage?.({
      source: windowObject,
      data: { type: 'HHR_RAYEN_CONNECTION_REPAIR_REQUEST', reqId: 'repair-2' },
    });
    await vi.waitFor(() =>
      expect(postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'HHR_RAYEN_CONNECTION_REPAIR_RESULT',
          reqId: 'repair-2',
          ok: false,
          error: expect.stringContaining('contexto invalidado'),
        }),
        'http://localhost:3001'
      )
    );
  });

  it('responde de inmediato cuando un contexto invalidado lanza de forma síncrona', async () => {
    const sendMessage = vi.fn((_message: Record<string, unknown>): Promise<unknown> => {
      throw new Error('Extension context invalidated');
    });
    const { onMessage, postMessage, windowObject } = createHarness(sendMessage);

    onMessage?.({
      source: windowObject,
      data: { type: 'HHR_RAYEN_CONNECTION_REPAIR_REQUEST', reqId: 'repair-sync-error' },
    });
    await vi.waitFor(() =>
      expect(postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'HHR_RAYEN_CONNECTION_REPAIR_RESULT',
          reqId: 'repair-sync-error',
          ok: false,
          error: expect.stringContaining('Extension context invalidated'),
        }),
        'http://localhost:3001'
      )
    );
  });

  it('no permite abrir pestañas sin una activación real del usuario', async () => {
    const sendMessage = vi.fn(async () => ({ ok: true }));
    const { onMessage, postMessage, windowObject } = createHarness(sendMessage, {
      userActive: false,
    });

    onMessage?.({
      source: windowObject,
      data: { type: 'HHR_RAYEN_CONNECTION_REPAIR_REQUEST', reqId: 'repair-without-gesture' },
    });
    await vi.waitFor(() =>
      expect(postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'HHR_RAYEN_CONNECTION_REPAIR_RESULT',
          reqId: 'repair-without-gesture',
          ok: false,
          error: expect.stringContaining('acción del usuario'),
        }),
        'http://localhost:3001'
      )
    );
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('confirma que el relé HHR pertenece a la versión y generación vigentes', async () => {
    const { onRuntimeMessage } = createHarness(vi.fn());
    const response = new Promise<Record<string, unknown>>(resolve => {
      const keepAlive = onRuntimeMessage?.(
        {
          type: 'RAYEN_EXTENSION_HHR_HEALTH_PING',
          runtimeGeneration: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
        },
        {},
        value => resolve(value as Record<string, unknown>)
      );
      expect(keepAlive).toBe(true);
    });

    await expect(response).resolves.toMatchObject({
      ready: true,
      reason: 'connected',
      bridgeVersion: '0.48.10',
      bridgeGeneration: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
    });
  });
});
