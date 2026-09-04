// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import '../../../extension/hhr-connection-repair-controls.js';
import '../../../extension/hhr-connection-center-runtime.js';

type Message = { type?: string; renew?: boolean };
type Runtime = {
  renderConnectionCenter: (root: HTMLElement, encId: string) => void;
  refreshOperationsConnectionBadge: (
    bar: HTMLElement,
    force?: boolean,
    report?: unknown
  ) => Promise<unknown>;
  invalidateConnectionState: (root: HTMLElement) => void;
  dispose: () => void;
};
type RuntimeOwner = { create: (dependencies: Record<string, unknown>) => Runtime };

const owner = () =>
  (globalThis as unknown as { HhrConnectionCenterRuntime: RuntimeOwner })
    .HhrConnectionCenterRuntime;

const messages = {
  EXTENSION_HEALTH_REQUEST: 'EXTENSION_HEALTH_REQUEST',
  CONNECTION_REPAIR_REQUEST: 'CONNECTION_REPAIR_REQUEST',
  GC_CONNECT_REQUEST: 'GC_CONNECT_REQUEST',
  GC_DISCONNECT_REQUEST: 'GC_DISCONNECT_REQUEST',
};

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => {
    resolve = done;
  });
  return { promise, resolve };
};

const report = (fichaStatus = 'ready', camasStatus = 'ready', name = 'Ana Riroroko') => ({
  version: '0.48.10',
  runtimeGeneration: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
  fichaMedico: {
    status: fichaStatus,
    reason: fichaStatus === 'ready' ? 'connected' : 'session_expired',
    identity: { fullName: name, role: 'Médico', practitionerRoleId: '10' },
  },
  gestionCamas: {
    status: camasStatus,
    reason: camasStatus === 'ready' ? 'connected' : 'session_expired',
    identity: { username: 'ana.riroroko' },
    remainingSeconds: 3_600,
    connectionSource: 'session',
    message: camasStatus === 'ready' ? '' : 'Inicia sesión para continuar.',
  },
  hhr: {
    status: 'ready',
    reason: 'connected',
    message: 'HHR enlazado.',
  },
});

const makeRoot = () => {
  const root = document.createElement('div');
  root.dataset.activeModule = 'connection';
  root.innerHTML = '<main class="hhr-center-main"></main>';
  document.body.appendChild(root);
  return root;
};

const makeBar = () => {
  const bar = document.createElement('aside') as HTMLElement & { __hhrRoot?: ShadowRoot };
  bar.id = 'operations-bar';
  const shadow = bar.attachShadow({ mode: 'open' });
  bar.__hhrRoot = shadow;
  shadow.innerHTML = `
    <button class="hhr-ops-handoff"></button>
    <button class="hhr-ops-session is-degraded">
      <span class="hhr-ops-avatar">HHR</span>
      <span class="session-name">Conexiones</span>
      <span class="session-state">Comprobando…</span>
    </button>
  `;
  document.body.appendChild(bar);
  return bar;
};

const flush = async () => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

const makeRuntime = (sendMessage: (message: Message) => Promise<unknown>) =>
  owner().create({
    documentRef: document,
    windowRef: window,
    runtimeMessages: messages,
    sendMessage,
    setLiveRegion: (element: HTMLElement, text: string, state = '') => {
      element.textContent = text;
      element.dataset.state = state;
    },
    connectionInitials: (name: string) =>
      name
        .split(/\s+/)
        .map(part => part[0])
        .join(''),
    connectionTimeLabel: () => 'Vence en 1 h',
    handoffLabelForIdentity: () => 'Entrega médica',
    operationsBarId: 'operations-bar',
  });

describe('Centro HHR connection runtime', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    document.body.innerHTML = '';
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('fails closed and loads the owner before its content-script consumer', () => {
    expect(() => owner().create({})).toThrow(/runtime de conexiones HHR/);
    expect(Object.isFrozen(owner())).toBe(true);

    const manifest = JSON.parse(readFileSync(path.resolve('extension/manifest.json'), 'utf8')) as {
      content_scripts?: Array<{ js?: string[] }>;
    };
    const scripts =
      manifest.content_scripts?.find(entry => entry.js?.includes('content-prescription-print.js'))
        ?.js || [];
    const content = readFileSync(path.resolve('extension/content-prescription-print.js'), 'utf8');
    const runtime = readFileSync(
      path.resolve('extension/hhr-connection-center-runtime.js'),
      'utf8'
    );

    expect(scripts.indexOf('hhr-connection-center-runtime.js')).toBeGreaterThan(-1);
    expect(scripts.indexOf('hhr-connection-center-runtime.js')).toBeLessThan(
      scripts.indexOf('content-prescription-print.js')
    );
    expect(content).toContain(
      'const connectionCenterOwner = globalThis.HhrConnectionCenterRuntime'
    );
    expect(content).toContain('renderConnectionCenter,');
    expect(content).not.toContain('const renderConnectionCenter =');
    expect(runtime).toContain('120');
    expect(runtime).toContain('schedulePanelTimer(controller, poll, 700)');
    expect(runtime).toContain('schedulePanelTimer(controller, poll, 1000)');
    expect(runtime).toContain('La contraseña se ingresa únicamente en la página oficial de Rayen');
  });

  it('ignores an older health response after a newer refresh has rendered', async () => {
    const first = deferred<unknown>();
    const second = deferred<unknown>();
    const sendMessage = vi
      .fn()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const runtime = makeRuntime(sendMessage);
    const root = makeRoot();

    runtime.renderConnectionCenter(root, '141121');
    root
      .querySelector<HTMLButtonElement>('.hhr-connection-refresh')
      ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    second.resolve(report('ready', 'ready', 'Respuesta nueva'));
    await flush();
    expect(root.querySelector('.hhr-connection-ficha .hhr-connection-user')?.firstChild?.nodeValue).toBe(
      'Respuesta nueva'
    );

    first.resolve(report('ready', 'missing', 'Respuesta vieja'));
    await flush();
    expect(root.querySelector('.hhr-connection-ficha .hhr-connection-user')?.firstChild?.nodeValue).toBe(
      'Respuesta nueva'
    );
    expect(root.querySelector('.hhr-connection-status')?.textContent).toBe('Conectado');
  });

  it('invalidates the previous render before the same root is rendered again', async () => {
    const oldLoad = deferred<unknown>();
    const newLoad = deferred<unknown>();
    const sendMessage = vi
      .fn()
      .mockReturnValueOnce(oldLoad.promise)
      .mockReturnValueOnce(newLoad.promise);
    const runtime = makeRuntime(sendMessage);
    const root = makeRoot();

    runtime.renderConnectionCenter(root, '1');
    runtime.renderConnectionCenter(root, '2');
    oldLoad.resolve(report('ready', 'ready', 'Paciente anterior'));
    await flush();
    expect(root.querySelector('.hhr-connection-ficha .hhr-connection-user')?.firstChild?.nodeValue).toBe(
      'Sesión clínica'
    );

    newLoad.resolve(report('ready', 'ready', 'Paciente vigente'));
    await flush();
    expect(root.querySelector('.hhr-connection-ficha .hhr-connection-user')?.firstChild?.nodeValue).toBe(
      'Paciente vigente'
    );
  });

  it('cancels the 700 ms start and 1 s polling timers on module change', async () => {
    const sendMessage = vi.fn(async (message: Message) => {
      if (message.type === messages.GC_CONNECT_REQUEST) return { message: 'Completa el acceso.' };
      return report('ready', 'missing');
    });
    const runtime = makeRuntime(sendMessage);
    const root = makeRoot() as HTMLElement & { __hhrConnectionDispose?: () => void };

    runtime.renderConnectionCenter(root, '141121');
    await flush();
    root.querySelector<HTMLButtonElement>('.hhr-connection-connect')?.click();
    await flush();
    expect(sendMessage).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(699);
    expect(sendMessage).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(sendMessage).toHaveBeenCalledTimes(3);
    await flush();

    root.__hhrConnectionDispose?.();
    root.dataset.activeModule = 'handoff';
    await vi.advanceTimersByTimeAsync(10_000);
    expect(sendMessage).toHaveBeenCalledTimes(3);
  });

  it('keeps a connect action current when the user refreshes during its await', async () => {
    const connect = deferred<unknown>();
    const sendMessage = vi.fn((message: Message) => {
      if (message.type === messages.GC_CONNECT_REQUEST) return connect.promise;
      return Promise.resolve(report('ready', 'missing'));
    });
    const runtime = makeRuntime(sendMessage);
    const root = makeRoot();
    runtime.renderConnectionCenter(root, '141121');
    await flush();

    root.querySelector<HTMLButtonElement>('.hhr-connection-connect')?.click();
    const forget = root.querySelector<HTMLButtonElement>('.hhr-connection-forget')!;
    expect(forget.disabled).toBe(true);
    forget.click();
    root.querySelector<HTMLButtonElement>('.hhr-connection-refresh')?.click();
    await flush();
    connect.resolve({ message: 'Completa el acceso en la ventana oficial.' });
    await flush();
    expect(root.querySelector('.hhr-connection-feedback')?.textContent).toBe(
      'Completa el acceso en la ventana oficial.'
    );
    expect(
      sendMessage.mock.calls.some(([message]) => message.type === messages.GC_DISCONNECT_REQUEST)
    ).toBe(false);

    await vi.advanceTimersByTimeAsync(700);
    expect(
      sendMessage.mock.calls.filter(
        ([message]) => message.type === messages.EXTENSION_HEALTH_REQUEST
      )
    ).toHaveLength(3);
  });

  it('serializes forget while allowing a refresh without losing its result', async () => {
    const disconnect = deferred<unknown>();
    let disconnected = false;
    const sendMessage = vi.fn((message: Message) => {
      if (message.type === messages.GC_DISCONNECT_REQUEST) return disconnect.promise;
      return Promise.resolve(report('ready', disconnected ? 'missing' : 'ready'));
    });
    const runtime = makeRuntime(sendMessage);
    const root = makeRoot();
    runtime.renderConnectionCenter(root, '141121');
    await flush();

    const forget = root.querySelector<HTMLButtonElement>('.hhr-connection-forget')!;
    forget.click();
    expect(forget.disabled).toBe(true);
    const connect = root.querySelector<HTMLButtonElement>('.hhr-connection-connect')!;
    expect(connect.disabled).toBe(true);
    connect.click();
    forget.click();
    root.querySelector<HTMLButtonElement>('.hhr-connection-refresh')?.click();
    await flush();
    expect(
      sendMessage.mock.calls.filter(([message]) => message.type === messages.GC_DISCONNECT_REQUEST)
    ).toHaveLength(1);
    expect(
      sendMessage.mock.calls.filter(([message]) => message.type === messages.GC_CONNECT_REQUEST)
    ).toHaveLength(0);

    disconnected = true;
    disconnect.resolve({ ok: true });
    await flush();
    expect(root.querySelector('.hhr-connection-camas')?.className).toContain('is-missing');
    expect(root.querySelector('.hhr-connection-feedback')?.textContent).toBe(
      'La sesión temporal de Gestión de Camas fue eliminada de la extensión.'
    );
  });

  it('restores refresh when connect or forget invalidates a pending load and fails', async () => {
    const initialLoad = deferred<unknown>();
    const connectRuntime = makeRuntime(
      vi.fn((message: Message) =>
        message.type === messages.GC_CONNECT_REQUEST
          ? Promise.resolve({ error: 'No se pudo conectar.' })
          : initialLoad.promise
      )
    );
    const connectRoot = makeRoot();
    connectRuntime.renderConnectionCenter(connectRoot, '141121');
    const connectRefresh = connectRoot.querySelector<HTMLButtonElement>('.hhr-connection-refresh')!;
    expect(connectRefresh.disabled).toBe(true);
    connectRoot.querySelector<HTMLButtonElement>('.hhr-connection-connect')?.click();
    await flush();
    expect(connectRefresh.disabled).toBe(false);
    expect(connectRoot.querySelector('.hhr-connection-feedback')?.textContent).toBe(
      'No se pudo conectar.'
    );
    initialLoad.resolve(report());
    await flush();
    expect(connectRefresh.disabled).toBe(false);

    connectRuntime.dispose();
    connectRoot.remove();
    const refreshLoad = deferred<unknown>();
    let healthCalls = 0;
    const forgetRuntime = makeRuntime(
      vi.fn((message: Message) => {
        if (message.type === messages.GC_DISCONNECT_REQUEST) {
          return Promise.resolve({ error: 'No se pudo olvidar.' });
        }
        healthCalls += 1;
        return healthCalls === 1 ? Promise.resolve(report()) : refreshLoad.promise;
      })
    );
    const forgetRoot = makeRoot();
    forgetRuntime.renderConnectionCenter(forgetRoot, '141121');
    await flush();
    const forgetRefresh = forgetRoot.querySelector<HTMLButtonElement>('.hhr-connection-refresh')!;
    forgetRefresh.click();
    expect(forgetRefresh.disabled).toBe(true);
    forgetRoot.querySelector<HTMLButtonElement>('.hhr-connection-forget')?.click();
    await flush();
    expect(forgetRefresh.disabled).toBe(false);
    expect(forgetRoot.querySelector('.hhr-connection-feedback')?.textContent).toBe(
      'No se pudo olvidar.'
    );
    refreshLoad.resolve(report());
    await flush();
    expect(forgetRefresh.disabled).toBe(false);
  });

  it('does not apply a disconnect result after the panel was replaced', async () => {
    const disconnect = deferred<unknown>();
    const sendMessage = vi.fn((message: Message) => {
      if (message.type === messages.GC_DISCONNECT_REQUEST) return disconnect.promise;
      return Promise.resolve(report());
    });
    const runtime = makeRuntime(sendMessage);
    const root = makeRoot() as HTMLElement & { __hhrConnectionDispose?: () => void };
    runtime.renderConnectionCenter(root, '141121');
    await flush();

    root.querySelector<HTMLButtonElement>('.hhr-connection-forget')?.click();
    await flush();
    root.__hhrConnectionDispose?.();
    root.dataset.activeModule = 'scores';
    root.querySelector('.hhr-center-main')!.innerHTML = '<div id="replacement">Scores</div>';
    disconnect.resolve({ ok: true });
    await flush();

    expect(root.querySelector('#replacement')?.textContent).toBe('Scores');
    expect(sendMessage).toHaveBeenCalledTimes(2);
  });

  it('lets a known report supersede an in-flight badge request and isolates a replacement bar', async () => {
    const oldBadge = deferred<unknown>();
    const replacementBadge = deferred<unknown>();
    const sendMessage = vi
      .fn()
      .mockReturnValueOnce(oldBadge.promise)
      .mockReturnValueOnce(replacementBadge.promise);
    const runtime = makeRuntime(sendMessage);
    const firstBar = makeBar();

    void runtime.refreshOperationsConnectionBadge(firstBar, true);
    await runtime.refreshOperationsConnectionBadge(
      firstBar,
      true,
      report('ready', 'missing', 'Estado conocido')
    );
    expect(firstBar.shadowRoot?.querySelector('.session-name')?.textContent).toBe(
      'Estado conocido'
    );
    expect(firstBar.shadowRoot?.querySelector('.session-state')?.textContent).toBe(
      'Conexión parcial'
    );

    oldBadge.resolve(report('ready', 'ready', 'Estado obsoleto'));
    await flush();
    expect(firstBar.shadowRoot?.querySelector('.session-name')?.textContent).toBe(
      'Estado conocido'
    );

    firstBar.remove();
    const secondBar = makeBar();
    const secondRequest = runtime.refreshOperationsConnectionBadge(secondBar);
    expect(sendMessage).toHaveBeenCalledTimes(2);
    replacementBadge.resolve(report('ready', 'ready', 'Barra nueva'));
    await secondRequest;
    expect(secondBar.shadowRoot?.querySelector('.session-name')?.textContent).toBe('Barra nueva');
  });

  it('dispose is idempotent and prevents pending work from repainting', async () => {
    const load = deferred<unknown>();
    const runtime = makeRuntime(vi.fn(() => load.promise));
    const root = makeRoot();
    runtime.renderConnectionCenter(root, '141121');

    runtime.dispose();
    runtime.dispose();
    load.resolve(report('ready', 'ready', 'No debe aparecer'));
    await flush();
    expect(root.querySelector('.hhr-connection-ficha .hhr-connection-user')?.firstChild?.nodeValue).toBe(
      'Sesión clínica'
    );
  });

  it('renders the four connection surfaces and copies a scrubbed diagnostic', async () => {
    const writeText = vi.fn<(value: string) => Promise<void>>(async () => undefined);
    Object.defineProperty(window.navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    const runtime = makeRuntime(vi.fn(async () => report()));
    const root = makeRoot();

    runtime.renderConnectionCenter(root, '141121');
    await flush();
    expect(root.querySelectorAll('.hhr-connection-card')).toHaveLength(4);
    expect(root.querySelector('.hhr-connection-extension .hhr-connection-user')?.textContent)
      .toContain('Versión 0.48.10');
    expect(root.querySelector('.hhr-connection-hhr .hhr-connection-status')?.textContent)
      .toBe('Conectado');

    root.querySelector<HTMLButtonElement>('.hhr-connection-copy')?.click();
    await flush();
    const copied = String(writeText.mock.calls[0]?.[0] || '');
    expect(copied).toContain('Extensión: 0.48.10 · generación aaaaaaaa');
    expect(copied).toContain('Ficha Médico: Conectado');
    expect(copied).toContain('HHR: Conectado');
    expect(copied).not.toContain('Ana Riroroko');
    expect(copied).not.toMatch(/token|RUN|RUT/i);
  });

  it('offers clean repair and asks for manual login only when the runtime confirms expiry', async () => {
    const expired = {
      ...report('missing', 'missing'),
      fichaMedico: {
        status: 'stale',
        reason: 'session_expired',
        message: 'La sesión venció.',
      },
      gestionCamas: {
        status: 'missing',
        reason: 'session_expired',
        message: 'La sesión venció.',
      },
    };
    const sendMessage = vi.fn(async (message: Message) =>
      message.type === messages.CONNECTION_REPAIR_REQUEST
        ? { ok: false, requiresLogin: true, report: expired }
        : expired
    );
    const runtime = makeRuntime(sendMessage);
    const root = makeRoot();
    runtime.renderConnectionCenter(root, '141121');
    await flush();

    root.querySelector<HTMLButtonElement>('.hhr-connection-repair')?.click();
    await flush();
    expect(sendMessage).toHaveBeenCalledWith({ type: messages.CONNECTION_REPAIR_REQUEST });
    expect(root.querySelector('.hhr-connection-feedback')?.textContent).toContain(
      'Iniciar sesión nuevamente'
    );
    expect(root.querySelector('.hhr-connection-ficha .hhr-connection-status')?.textContent)
      .toBe('Sesión vencida');
  });

});
