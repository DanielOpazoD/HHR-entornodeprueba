// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';

import '../../../extension/health-check.js';
import '../../../extension/gestion-camas-session.js';
import '../../../extension/gestion-camas-health.js';
import '../../../extension/gestion-camas-runtime.js';

type StoredValues = Record<string, unknown>;
// The default unit fixture models freshness as a finite session timestamp.
// Lifecycle regressions below opt into the real session owner, including expiry.
const FINITE_SESSION_TIMESTAMP = 1;

const createFixture = (
  initial: StoredValues = {},
  options: { tabs?: Array<{ id: number; windowId?: number }>; fullLifecycle?: boolean } = {}
) => {
  const values: StoredValues = { ...initial };
  const storage = {
    get: vi.fn(async (key: string | null) => {
      if (key === null) return { ...values };
      return { [key]: values[key] };
    }),
    set: vi.fn(async (entries: StoredValues) => {
      Object.assign(values, entries);
    }),
    remove: vi.fn(async (keys: string | string[]) => {
      for (const key of Array.isArray(keys) ? keys : [keys]) delete values[key];
    }),
  };
  const session = {
    SESSION_STORAGE_KEY: 'gc-session',
    PENDING_WINDOW_STORAGE_KEY: 'gc-pending',
    CONNECTION_CONTROL_STORAGE_KEY: 'gc-control',
    CLOSING_WINDOW_STORAGE_KEY: 'gc-closing',
    buildSessionRecord: (info: Record<string, unknown>) =>
      info?.accessValue && info?.apiBase && info?.facId
        ? {
            accessValue: info.accessValue,
            apiBase: info.apiBase,
            facId: info.facId,
            capturedAt: FINITE_SESSION_TIMESTAMP,
            lastVerifiedAt: null,
            expiresAt: null,
            identity: {},
          }
        : null,
    isUsable: (record: Record<string, unknown> | null) =>
      Boolean(record?.accessValue && record?.apiBase && record?.facId),
    isVerificationFresh: (record: Record<string, unknown> | null) =>
      Number.isFinite(record?.lastVerifiedAt),
    publicStatus: (record: Record<string, unknown> | null) => ({
      status: record ? 'ready' : 'missing',
      connected: Boolean(record),
    }),
  };
  const chromeApi = {
    storage: { session: storage },
    tabs: {
      query: vi.fn(async () => options.tabs ?? [{ id: 7 }]),
      get: vi.fn(async (id: number) => (options.tabs ?? [{ id: 7 }]).find(tab => tab.id === id)),
      sendMessage: vi.fn(
        async (
          _id: number,
          _message: Record<string, unknown>
        ): Promise<Record<string, unknown>> => ({ ready: true, message: 'Pestaña disponible.' })
      ),
      update: vi.fn(),
    },
    windows: {
      create: vi.fn(),
      update: vi.fn(),
      remove: vi.fn(async () => undefined),
    },
  };
  const runtimeFactory = (
    globalThis as typeof globalThis & {
      HhrGestionCamasRuntime: {
        create: (dependencies: Record<string, unknown>) => {
          captureSession: (info: Record<string, unknown>, sender: unknown) => Promise<unknown>;
          classifyRejection: (
            response: { status: number },
            record: Record<string, unknown>
          ) => Promise<string>;
          health: (
            runtimeGeneration?: string,
            targetTabIds?: number[]
          ) => Promise<Record<string, unknown>>;
          connect: (options?: { renew?: boolean }) => Promise<Record<string, unknown>>;
          disconnect: () => Promise<Record<string, unknown>>;
        };
      };
    }
  ).HhrGestionCamasRuntime;

  const fetchWithTimeout = vi.fn();
  const probeTabs = vi.fn(async ({ tabs }: { tabs: unknown[] }) =>
    tabs.length > 0
      ? { status: 'ready', message: 'Pestaña disponible.' }
      : { status: 'missing', message: 'Abre Gestión de Camas.' }
  );
  const runtime = runtimeFactory.create({
    chrome: chromeApi,
    session: options.fullLifecycle
      ? {
          ...(globalThis as typeof globalThis & { HhrGestionCamasSession: Record<string, unknown> })
            .HhrGestionCamasSession,
          SESSION_STORAGE_KEY: session.SESSION_STORAGE_KEY,
          PENDING_WINDOW_STORAGE_KEY: session.PENDING_WINDOW_STORAGE_KEY,
          CONNECTION_CONTROL_STORAGE_KEY: session.CONNECTION_CONTROL_STORAGE_KEY,
          CLOSING_WINDOW_STORAGE_KEY: session.CLOSING_WINDOW_STORAGE_KEY,
        }
      : session,
    extensionHealth: options.fullLifecycle
      ? (globalThis as typeof globalThis & { HhrExtensionHealth: Record<string, unknown> })
          .HhrExtensionHealth
      : {
          orderTabs: (tabs: unknown[]) => tabs,
          resolveTabs: async (
            tabsApi: {
              query: (query: unknown) => Promise<unknown[]>;
              get: (id: number) => Promise<unknown>;
            },
            url: string,
            targetTabIds?: number[]
          ) =>
            Array.isArray(targetTabIds)
              ? (await Promise.all(targetTabIds.map(id => tabsApi.get(id)))).filter(Boolean)
              : tabsApi.query({ url }),
          probeTabs,
        },
    withTimeout: (promise: Promise<unknown>) => promise,
    fetchWithTimeout,
    backendRequestTimeoutMs: 45_000,
    tabMessageTimeoutMs: 50_000,
    healthProbeTimeoutMs: 5_000,
  });

  return { runtime, values, storage, fetchWithTimeout, chromeApi, probeTabs };
};

describe('Gestión de Camas connection runtime', () => {
  it('fails closed when its required dependencies are incomplete', () => {
    const factory = (
      globalThis as typeof globalThis & {
        HhrGestionCamasRuntime: { create: (dependencies: unknown) => unknown };
      }
    ).HhrGestionCamasRuntime;

    expect(() => factory.create({})).toThrow(/inicializar el runtime/);
  });

  it('binds an initial captured session to its source tab and rejects stale captures', async () => {
    const { runtime, values } = createFixture({}, { tabs: [{ id: 17 }] });
    const info = {
      accessValue: 'fixture',
      apiBase: 'https://hospbackend.rayensalud.cl/api',
      facId: '1342',
    };

    await expect(runtime.captureSession(info, { tab: { id: 17 } })).resolves.toMatchObject({
      ok: true,
      connection: { status: 'ready' },
    });
    expect(values['gc-session']).toMatchObject({
      sourceTabId: 17,
      connectionAttemptId: '',
    });
    await expect(runtime.captureSession(info, { tab: { id: 18 } })).rejects.toThrow(
      /intento de conexión anterior/
    );
  });

  it('acepta la captura adelantada al handshake desde la pestaña del intento pendiente', async () => {
    // La ventana oficial emite su bootstrap autenticado antes de recibir el id
    // del intento: la captura llega sin attemptId pero desde la pestaña del
    // intento. Debe aceptarse y adoptar el id pendiente para que la
    // verificación pueda completar el intento manteniendo la pestaña viva.
    const { runtime, values } = createFixture(
      { 'gc-pending': { tabId: 21, attemptId: 'attempt-x' } },
      { tabs: [{ id: 21 }] }
    );

    await expect(
      runtime.captureSession(
        {
          accessValue: 'bootstrap',
          apiBase: 'https://hospbackend.rayensalud.cl/api',
          facId: '1342',
        },
        { tab: { id: 21 } }
      )
    ).resolves.toMatchObject({ ok: true });
    expect(values['gc-session']).toMatchObject({
      sourceTabId: 21,
      connectionAttemptId: 'attempt-x',
    });

    // Desde OTRA pestaña, la captura sin attemptId sigue rechazada mientras
    // el intento pendiente está vivo.
    const other = createFixture(
      { 'gc-pending': { tabId: 21, attemptId: 'attempt-x' } },
      { tabs: [{ id: 21 }, { id: 22 }] }
    );
    await expect(
      other.runtime.captureSession(
        {
          accessValue: 'ajena',
          apiBase: 'https://hospbackend.rayensalud.cl/api',
          facId: '1342',
        },
        { tab: { id: 22 } }
      )
    ).rejects.toThrow(/intento de conexión anterior/);
  });

  it('adopta la captura de una pestaña viva cuando la sesión vigente quedó huérfana', async () => {
    // La pestaña 17 (dueña de la sesión) ya no existe; la 18 está viva y
    // autenticada. La sesión huérfana no debe exigir reconexión manual.
    const { runtime, values } = createFixture(
      {
        'gc-session': {
          accessValue: 'huérfana',
          apiBase: 'https://hospbackend.rayensalud.cl/api',
          facId: '1342',
          sourceTabId: 17,
          connectionAttemptId: '',
        },
      },
      { tabs: [{ id: 18 }] }
    );

    await expect(
      runtime.captureSession(
        {
          accessValue: 'viva',
          apiBase: 'https://hospbackend.rayensalud.cl/api',
          facId: '1342',
        },
        { tab: { id: 18 } }
      )
    ).resolves.toMatchObject({ ok: true, connection: { status: 'ready' } });
    expect(values['gc-session']).toMatchObject({ accessValue: 'viva', sourceTabId: 18 });
  });

  it('forgets the temporary session and blocks silent recapture on disconnect', async () => {
    const { runtime, values, storage } = createFixture({
      'gc-session': { accessValue: 'fixture', apiBase: 'api', facId: '1342' },
      'gc-pending': { tabId: 4, attemptId: 'attempt' },
    });

    await expect(runtime.disconnect()).resolves.toMatchObject({
      ok: true,
      connection: { status: 'missing' },
    });
    expect(values['gc-session']).toBeUndefined();
    expect(values['gc-pending']).toBeUndefined();
    expect(values['gc-control']).toMatchObject({ blocked: true });
    expect(storage.remove).toHaveBeenCalledWith(['gc-session', 'gc-pending']);
  });

  it('keeps a fresh verified session without making another network probe', async () => {
    const record = {
      accessValue: 'fixture',
      apiBase: 'https://hospbackend.rayensalud.cl/api',
      facId: '1342',
      sourceTabId: 7,
      connectionAttemptId: '',
      lastVerifiedAt: FINITE_SESSION_TIMESTAMP,
    };
    const { runtime, fetchWithTimeout } = createFixture({ 'gc-session': record });

    await expect(runtime.health()).resolves.toMatchObject({
      status: 'ready',
      connected: true,
    });
    expect(fetchWithTimeout).not.toHaveBeenCalled();
  });

  it('scopes clean-repair health and the stored session to the exact new Gestión de Camas tab', async () => {
    const record = {
      accessValue: 'fixture',
      apiBase: 'https://hospbackend.rayensalud.cl/api',
      facId: '1342',
      sourceTabId: 8,
      connectionAttemptId: '',
      lastVerifiedAt: FINITE_SESSION_TIMESTAMP,
    };
    const { runtime, probeTabs } = createFixture(
      { 'gc-session': record },
      { tabs: [{ id: 7 }, { id: 8 }] }
    );

    await expect(runtime.health('generation', [8])).resolves.toMatchObject({ status: 'ready' });
    expect(probeTabs.mock.calls[0]?.[0]).toMatchObject({ tabs: [{ id: 8 }] });
  });

  it('does not report a stored session as ready after its source tab was closed', async () => {
    const record = {
      accessValue: 'fixture',
      apiBase: 'https://hospbackend.rayensalud.cl/api',
      facId: '1342',
      sourceTabId: 7,
      connectionAttemptId: '',
      lastVerifiedAt: FINITE_SESSION_TIMESTAMP,
    };
    const { runtime } = createFixture({ 'gc-session': record }, { tabs: [] });

    await expect(runtime.health()).resolves.toMatchObject({
      status: 'missing',
      message: 'Abre Gestión de Camas.',
    });

    // Con una pestaña de reemplazo abierta, el health intenta adoptar su sesión
    // en vivo; si el relé no entrega credencial, queda stale (no ready).
    const replacementTab = createFixture({ 'gc-session': record }, { tabs: [{ id: 8 }] });
    await expect(replacementTab.runtime.health()).resolves.toMatchObject({
      status: 'stale',
    });
  });

  it('el health adopta en vivo la sesión de una pestaña de reemplazo autenticada', async () => {
    const record = {
      accessValue: 'huérfana',
      apiBase: 'https://hospbackend.rayensalud.cl/api',
      facId: '1342',
      sourceTabId: 7,
      connectionAttemptId: '',
      lastVerifiedAt: FINITE_SESSION_TIMESTAMP,
    };
    const fixture = createFixture({ 'gc-session': record }, { tabs: [{ id: 8 }] });
    // La pestaña viva entrega su credencial al relé y el probe la verifica.
    fixture.chromeApi.tabs.sendMessage.mockImplementation(
      async (...args: unknown[]): Promise<never> =>
        ((args[1] as { type?: string } | undefined)?.type === 'RAYEN_GC_GET_FETCH_INFO'
          ? {
              info: {
                accessValue: 'viva',
                apiBase: 'https://hospbackend.rayensalud.cl/api',
                facId: '1342',
              },
            }
          : { ready: true, message: 'Pestaña disponible.' }) as never
    );
    fixture.fetchWithTimeout.mockResolvedValue({ ok: true });

    await expect(fixture.runtime.health()).resolves.toMatchObject({ status: 'ready' });
    expect(fixture.values['gc-session']).toMatchObject({ accessValue: 'viva', sourceTabId: 8 });
  });

  it('does not call a missing capture an expired session without a Rayen rejection', async () => {
    const { runtime } = createFixture({}, { tabs: [{ id: 8 }] });

    await expect(runtime.health()).resolves.toMatchObject({
      status: 'missing',
      reason: 'session_unverified',
    });
  });

  it('reports session_expired only after Rayen returns unauthorized', async () => {
    const record = {
      accessValue: 'fixture',
      apiBase: 'https://hospbackend.rayensalud.cl/api',
      facId: '1342',
      sourceTabId: 7,
      connectionAttemptId: 'current',
      lastVerifiedAt: null,
    };
    const { runtime, fetchWithTimeout } = createFixture({ 'gc-session': record });
    fetchWithTimeout.mockResolvedValue({ ok: false, status: 401 });

    await expect(runtime.health()).resolves.toMatchObject({
      status: 'stale',
      reason: 'session_expired',
    });
  });

  it('clears only the matching session when Rayen returns an unauthorized response', async () => {
    const record = {
      accessValue: 'fixture',
      apiBase: 'https://hospbackend.rayensalud.cl/api',
      facId: '1342',
      sourceTabId: 7,
      connectionAttemptId: 'current',
    };
    const { runtime, values } = createFixture({ 'gc-session': record });

    await expect(runtime.classifyRejection({ status: 401 }, record)).resolves.toBe('expired');
    expect(values['gc-session']).toBeUndefined();
  });
});

// Real session/health/runtime owners, with only Chrome and the Rayen network mocked.
const createPopupLifecycle = () => {
  const tabs: Array<{ id: number; windowId: number }> = [];
  const fixture = createFixture({}, { tabs, fullLifecycle: true });
  const popupTab = { id: 27, windowId: 12 };
  const expiresAt = Date.now() + 60 * 60 * 1000;
  const payload = Buffer.from(JSON.stringify({ exp: expiresAt / 1000 })).toString('base64url');
  const info = {
    token: `Bearer fixture.${payload}.signature`,
    apiBase: 'https://hospbackend.rayensalud.cl/api',
    facId: '1342',
  };
  fixture.chromeApi.windows.create.mockImplementation(async () => {
    tabs.push(popupTab);
    return { id: popupTab.windowId, tabs: [popupTab] };
  });
  fixture.chromeApi.windows.remove.mockImplementation(async () => {
    tabs.splice(0);
  });
  fixture.chromeApi.tabs.sendMessage.mockImplementation(async (_id, message) =>
    message.type === 'RAYEN_GC_SET_CONNECTION_ATTEMPT'
      ? { ok: true }
      : message.type === 'RAYEN_EXTENSION_HEALTH_PING'
        ? { ready: true, bridgeVersion: 'fixture', bridgeGeneration: 'generation' }
        : { error: 'No live credential available.' }
  );
  fixture.fetchWithTimeout.mockResolvedValue({ ok: true, status: 200 });
  const connectAndVerify = async () => {
    await expect(fixture.runtime.connect()).resolves.toMatchObject({ ok: true, reused: false });
    expect(fixture.chromeApi.windows.create).toHaveBeenCalledWith(
      expect.objectContaining({
        url: 'https://hospitalizado.rayensalud.cl/',
        type: 'popup',
      })
    );
    expect(fixture.values['gc-pending']).toMatchObject({
      tabId: 27,
      windowId: 12,
      closeOnVerify: false,
    });
    expect(fixture.chromeApi.tabs.sendMessage).toHaveBeenCalledWith(27, {
      type: 'RAYEN_GC_SET_CONNECTION_ATTEMPT',
      connectionAttemptId: expect.any(String),
      rehydrated: false,
    });
    await expect(fixture.runtime.captureSession(info, { tab: popupTab })).resolves.toMatchObject({
      ok: true,
      connection: { status: 'stale', verification: 'pending' },
    });
    await expect(fixture.runtime.health('generation')).resolves.toMatchObject({
      status: 'ready',
      reason: 'connected',
      verification: 'fresh',
    });
    expect(fixture.fetchWithTimeout).toHaveBeenCalledWith(
      expect.stringContaining('/facility/1342/encounter'),
      { headers: { Authorization: info.token } },
      5_000
    );
    expect(fixture.values['gc-pending']).toBeUndefined();
  };
  return { ...fixture, tabs, popupTab, info, expiresAt, connectAndVerify };
};

describe('Gestión de Camas new-popup lifecycle', () => {
  afterEach(() => vi.useRealTimers());

  it('keeps the verified popup alive after 450ms and still requires its live tab and relay', async () => {
    vi.useFakeTimers();
    const fixture = createPopupLifecycle();
    await fixture.connectAndVerify();
    await vi.advanceTimersByTimeAsync(450);
    expect(fixture.chromeApi.windows.remove).not.toHaveBeenCalled();
    expect(fixture.values['gc-closing']).toBeUndefined();
    expect(fixture.tabs).toEqual([fixture.popupTab]);
    await expect(fixture.runtime.health('generation')).resolves.toMatchObject({
      status: 'ready',
      verification: 'fresh',
      bridgeGeneration: 'generation',
    });
    expect(fixture.chromeApi.tabs.sendMessage).toHaveBeenCalledWith(27, {
      type: 'RAYEN_EXTENSION_HEALTH_PING',
      runtimeGeneration: 'generation',
    });
    expect(fixture.fetchWithTimeout).toHaveBeenCalledTimes(1);

    fixture.chromeApi.tabs.sendMessage.mockResolvedValue({
      ready: false,
      reason: 'relay_disconnected',
      message: 'Relay unavailable.',
    });
    await expect(fixture.runtime.health()).resolves.toMatchObject({
      status: 'stale',
      reason: 'relay_disconnected',
    });
    fixture.tabs.splice(0); // The user can still close the source intentionally.
    await expect(fixture.runtime.health()).resolves.toMatchObject({
      status: 'missing',
      reason: 'tab_missing',
    });
    expect(fixture.values['gc-session']).toBeDefined(); // Stored credentials cannot bypass either gate.
  });

  it('blocks silent recapture after intentional disconnect even though the popup stays open', async () => {
    vi.useFakeTimers();
    const fixture = createPopupLifecycle();
    await fixture.connectAndVerify();
    const attemptId = (fixture.values['gc-session'] as Record<string, unknown>).connectionAttemptId;
    await expect(fixture.runtime.disconnect()).resolves.toMatchObject({
      ok: true,
      connection: { status: 'missing' },
    });
    fixture.chromeApi.tabs.sendMessage.mockImplementation(async (_id, message) =>
      message.type === 'RAYEN_EXTENSION_HEALTH_PING' ? { ready: true } : { info: fixture.info }
    );
    for (const info of [fixture.info, { ...fixture.info, connectionAttemptId: attemptId }]) {
      await expect(fixture.runtime.captureSession(info, { tab: fixture.popupTab })).rejects.toThrow(
        /intento de conexión anterior/
      );
    }
    await vi.advanceTimersByTimeAsync(450);
    await expect(fixture.runtime.health()).resolves.toMatchObject({
      status: 'missing',
      reason: 'session_unverified',
    });
    expect(fixture.values['gc-session']).toBeUndefined();
    expect(fixture.values['gc-pending']).toBeUndefined();
    expect(fixture.values['gc-control']).toMatchObject({ blocked: true });
    expect(fixture.chromeApi.windows.remove).not.toHaveBeenCalled();
    expect(fixture.tabs).toEqual([fixture.popupTab]);
    expect(fixture.fetchWithTimeout).toHaveBeenCalledTimes(1);
  });

  it('clears the retained popup session when re-verification receives a 401', async () => {
    vi.useFakeTimers();
    const fixture = createPopupLifecycle();
    await fixture.connectAndVerify();
    await vi.advanceTimersByTimeAsync(15 * 60 * 1000 + 1);
    fixture.fetchWithTimeout.mockResolvedValue({ ok: false, status: 401 });
    await expect(fixture.runtime.health()).resolves.toMatchObject({
      status: 'stale',
      reason: 'session_expired',
    });
    expect(fixture.values['gc-session']).toBeUndefined();
    expect(fixture.chromeApi.windows.remove).not.toHaveBeenCalled();
    expect(fixture.tabs).toEqual([fixture.popupTab]);
  });

  it('does not keep readiness after the retained popup credential expires', async () => {
    vi.useFakeTimers();
    const fixture = createPopupLifecycle();
    await fixture.connectAndVerify();
    await vi.advanceTimersByTimeAsync(fixture.expiresAt - Date.now() + 1);
    await expect(fixture.runtime.health()).resolves.toMatchObject({
      status: 'missing',
      reason: 'session_unverified',
    });
    expect(fixture.values['gc-session']).toBeUndefined();
    expect(fixture.fetchWithTimeout).toHaveBeenCalledTimes(1);
    expect(fixture.chromeApi.windows.remove).not.toHaveBeenCalled();
    expect(fixture.tabs).toEqual([fixture.popupTab]);
  });

  it('preserves the legacy explicitly requested closeOnVerify mechanism', async () => {
    vi.useFakeTimers();
    const fixture = createPopupLifecycle();
    await fixture.runtime.connect();
    (fixture.values['gc-pending'] as Record<string, unknown>).closeOnVerify = true;
    await fixture.runtime.captureSession(fixture.info, { tab: fixture.popupTab });
    await expect(fixture.runtime.health()).resolves.toMatchObject({ status: 'ready' });
    await vi.advanceTimersByTimeAsync(449);
    expect(fixture.chromeApi.windows.remove).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(fixture.chromeApi.windows.remove).toHaveBeenCalledWith(12);
    await expect(fixture.runtime.health()).resolves.toMatchObject({
      status: 'missing',
      reason: 'tab_missing',
    });
  });
});
