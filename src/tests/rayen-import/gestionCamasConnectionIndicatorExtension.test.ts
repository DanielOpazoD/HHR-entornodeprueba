// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import '../../../extension/hhr-connection-action-model.js';
import '../../../extension/gestion-camas-connection-indicator.js';

type Indicator = { mount: () => boolean; refresh: () => Promise<unknown>; dispose: () => void };
type IndicatorOwner = {
  HOST_ID: string;
  create: (dependencies: Record<string, unknown>) => Indicator;
};

const owner = () =>
  (globalThis as unknown as { HhrGestionCamasConnectionIndicator: IndicatorOwner })
    .HhrGestionCamasConnectionIndicator;
const actionModel = () =>
  (globalThis as unknown as { HhrConnectionActionModel: Record<string, unknown> })
    .HhrConnectionActionModel;
const messages = {
  EXTENSION_HEALTH_REQUEST: 'EXTENSION_HEALTH_REQUEST',
  CONNECTION_REPAIR_REQUEST: 'CONNECTION_REPAIR_REQUEST',
  GC_CONNECT_REQUEST: 'GC_CONNECT_REQUEST',
};
const ready = { status: 'ready', reason: 'connected', message: 'Vigente.' };
const report = (ficha = ready, camas = ready) => ({
  version: '0.48.12',
  capabilities: ['clean-connection-repair'],
  fichaMedico: ficha,
  gestionCamas: camas,
  hhr: ready,
});

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => {
    resolve = done;
  });
  return { promise, resolve };
};

const makeRuntime = (
  sendMessage: (message: Record<string, unknown>) => Promise<unknown>,
  isUserActivationAllowed: (event: Event) => boolean = () => true
) => {
  let runtimeListener: ((message: Record<string, unknown>) => void) | undefined;
  const chromeApi = {
    runtime: {
      sendMessage: vi.fn(sendMessage),
      getURL: vi.fn((value: string) => `chrome-extension://test/${value}`),
      onMessage: {
        addListener: vi.fn((listener: (message: Record<string, unknown>) => void) => {
          runtimeListener = listener;
        }),
        removeListener: vi.fn(),
      },
    },
  };
  const runtime = owner().create({
    documentRef: document,
    windowRef: window,
    chromeApi,
    runtimeMessages: messages,
    actionModel: actionModel(),
    isUserActivationAllowed,
  });
  runtime.mount();
  return { runtime, chromeApi, getRuntimeListener: () => runtimeListener };
};

const host = () => document.getElementById(owner().HOST_ID) as HTMLElement;
const part = <T extends Element>(selector: string): T | null =>
  host()?.shadowRoot?.querySelector<T>(selector) ?? null;

describe('indicador de conexiones en Gestión de Camas', () => {
  afterEach(() => {
    const current = host() as (HTMLElement & { __hhrDispose?: () => void }) | null;
    current?.__hhrDispose?.();
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('muestra una barra compacta sin acciones cuando todas las fuentes están vigentes', async () => {
    const { runtime } = makeRuntime(async () => report());
    await runtime.refresh();

    expect(part('.summary')?.textContent).toBe('Conectado');
    expect(part<HTMLButtonElement>('.primary')?.hidden).toBe(true);
    expect(part<HTMLImageElement>('.brand img')?.src).toContain('hhr-logo.svg');
    expect(host().getAttribute('aria-label')).toContain('Estado de conexión');
  });

  it('ofrece solo abrir Gestión de Camas cuando Ficha Médico sigue vigente', async () => {
    const missing = report(ready, {
      status: 'missing',
      reason: 'tab_missing',
      message: 'Pestaña no abierta.',
    });
    const { runtime, chromeApi } = makeRuntime(async message =>
      message.type === messages.GC_CONNECT_REQUEST
        ? { ok: true, message: 'Ventana abierta.' }
        : missing
    );
    await runtime.refresh();
    part<HTMLButtonElement>('.trigger')?.click();

    const action = part<HTMLButtonElement>('.primary')!;
    expect(action.hidden).toBe(false);
    expect(action.textContent).toBe('Abrir Gestión de Camas');
    await vi.waitFor(() => expect(action.disabled).toBe(false));
    action.click();
    await vi.waitFor(() =>
      expect(chromeApi.runtime.sendMessage).toHaveBeenCalledWith({
        type: messages.GC_CONNECT_REQUEST,
        renew: false,
      })
    );
  });

  it('reutiliza la reparación limpia, conserva la indicación de login y acepta health push', async () => {
    const expired = report(
      { status: 'stale', reason: 'session_expired', message: 'Sesión vencida.' },
      { status: 'missing', reason: 'session_expired', message: 'Sesión vencida.' }
    );
    const repaired = report();
    const health = expired;
    const { runtime, chromeApi, getRuntimeListener } = makeRuntime(async message => {
      if (message.type === messages.CONNECTION_REPAIR_REQUEST) {
        return { ok: false, requiresLogin: true };
      }
      return health;
    });
    await runtime.refresh();
    const action = part<HTMLButtonElement>('.primary')!;
    expect(action.textContent).toBe('Iniciar sesión en pestañas nuevas');
    action.click();
    await vi.waitFor(() =>
      expect(chromeApi.runtime.sendMessage).toHaveBeenCalledWith({
        type: messages.CONNECTION_REPAIR_REQUEST,
      })
    );
    await vi.waitFor(() =>
      expect(part('.feedback')?.textContent).toContain('Completa el inicio de sesión')
    );

    getRuntimeListener()?.({
      type: 'RAYEN_EXTENSION_HEALTH_PUSH',
      report: expired,
    });
    expect(part('.summary')?.textContent).toBe('Sesión vencida');
    expect(part('.feedback')?.textContent).toContain('Completa el inicio de sesión');

    getRuntimeListener()?.({
      type: 'RAYEN_EXTENSION_HEALTH_PUSH',
      report: repaired,
    });
    expect(part('.summary')?.textContent).toBe('Conectado');
    expect(part('.feedback')?.textContent).toBe('');
  });

  it('no restaura un aviso obsoleto después de un health push más nuevo', async () => {
    const expired = report(
      { status: 'stale', reason: 'session_expired', message: 'Sesión vencida.' },
      { status: 'missing', reason: 'session_expired', message: 'Sesión vencida.' }
    );
    const pendingRefresh = deferred<unknown>();
    let healthRequests = 0;
    const { runtime, getRuntimeListener } = makeRuntime(async message => {
      if (message.type === messages.CONNECTION_REPAIR_REQUEST) {
        return { ok: false, requiresLogin: true };
      }
      healthRequests += 1;
      return healthRequests <= 2 ? expired : pendingRefresh.promise;
    });
    await runtime.refresh();
    part<HTMLButtonElement>('.primary')?.click();
    await vi.waitFor(() => expect(healthRequests).toBe(3));

    getRuntimeListener()?.({ type: 'RAYEN_EXTENSION_HEALTH_PUSH', report: report() });
    pendingRefresh.resolve(expired);
    await vi.waitFor(() => expect(part('.summary')?.textContent).toBe('Conectado'));
    expect(part('.feedback')?.textContent).toBe('');
  });

  it('deshabilita la acción anterior mientras obtiene un reporte fresco', async () => {
    const missing = report(ready, {
      status: 'missing',
      reason: 'tab_missing',
      message: 'Pestaña no abierta.',
    });
    const pendingRefresh = deferred<unknown>();
    let healthRequests = 0;
    const { runtime } = makeRuntime(async () => {
      healthRequests += 1;
      return healthRequests <= 2 ? missing : pendingRefresh.promise;
    });
    await runtime.refresh();
    const action = part<HTMLButtonElement>('.primary')!;

    const refreshing = runtime.refresh();
    expect(action.disabled).toBe(true);
    pendingRefresh.resolve(report());
    await refreshing;

    expect(action.hidden).toBe(true);
    expect(action.disabled).toBe(false);
  });

  it('rechaza acciones programáticas y deriva la acción desde el reporte, no desde el DOM', async () => {
    const expired = report(
      { status: 'stale', reason: 'session_expired', message: 'Sesión vencida.' },
      { status: 'missing', reason: 'session_expired', message: 'Sesión vencida.' }
    );
    const sendMessage = vi.fn(async () => expired);
    const { runtime } = makeRuntime(sendMessage, () => false);
    await runtime.refresh();

    const action = part<HTMLButtonElement>('.primary')!;
    action.dataset.action = 'refresh';
    action.click();
    await Promise.resolve();

    expect(part('.feedback')?.textContent).toContain('clic directo del usuario');
    expect(sendMessage).not.toHaveBeenCalledWith({ type: messages.CONNECTION_REPAIR_REQUEST });
  });

  it('rechaza una respuesta de salud antigua y reemplaza una barra previa sin duplicarla', async () => {
    const oldHealth = deferred<unknown>();
    const freshHealth = deferred<unknown>();
    const sendMessage = vi
      .fn()
      .mockReturnValueOnce(oldHealth.promise)
      .mockReturnValueOnce(freshHealth.promise);
    const { runtime } = makeRuntime(sendMessage);
    const pending = runtime.refresh();
    freshHealth.resolve(report());
    await pending;
    oldHealth.resolve(
      report(ready, { status: 'missing', reason: 'tab_missing', message: 'Antigua.' })
    );
    await Promise.resolve();
    expect(part('.summary')?.textContent).toBe('Conectado');

    makeRuntime(async () => report());
    expect(document.querySelectorAll(`#${owner().HOST_ID}`)).toHaveLength(1);
  });

  it('queda cableado después del modelo compartido y expone el logo en Gestión de Camas', () => {
    const manifest = JSON.parse(readFileSync(path.resolve('extension/manifest.json'), 'utf8')) as {
      content_scripts: Array<{ matches: string[]; js: string[] }>;
      web_accessible_resources: Array<{ resources: string[]; matches: string[] }>;
    };
    const scripts =
      manifest.content_scripts.find(
        entry =>
          entry.matches.includes('https://hospitalizado.rayensalud.cl/*') &&
          entry.js.includes('content-gestioncamas.js')
      )?.js ?? [];
    expect(scripts.indexOf('hhr-connection-action-model.js')).toBeLessThan(
      scripts.indexOf('gestion-camas-connection-indicator.js')
    );
    expect(scripts.indexOf('gestion-camas-connection-indicator.js')).toBeLessThan(
      scripts.indexOf('content-gestioncamas.js')
    );
    expect(
      manifest.web_accessible_resources.some(
        entry =>
          entry.resources.includes('hhr-logo.svg') &&
          entry.matches.includes('https://hospitalizado.rayensalud.cl/*')
      )
    ).toBe(true);
  });
});
