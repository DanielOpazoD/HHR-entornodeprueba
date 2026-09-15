// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import '../../../extension/health-push-ordering-runtime.js';
import '../../../extension/health-heartbeat-runtime.js';

type HeartbeatRuntime = {
  create: (deps: Record<string, unknown>) => {
    start: () => boolean;
    pushNow: (reason: string) => Promise<{ pushed: number }>;
    pushAfter: (
      handle: (...args: unknown[]) => unknown,
      reason: string,
      reportFromResult?: (result: unknown) => unknown
    ) => (...args: unknown[]) => Promise<unknown>;
  };
  HEALTH_PUSH_MESSAGE_TYPE: string;
  PUBLICATION_SEQUENCE_STORAGE_KEY: string;
};

const runtimeModule = (globalThis as unknown as { HhrHealthHeartbeatRuntime: HeartbeatRuntime })
  .HhrHealthHeartbeatRuntime;

const REPORT = { version: '0.48.0', gestionCamas: { status: 'ready' } };
const PATTERNS = ['http://localhost:3001/*'];

const createFixture = (overrides: Record<string, unknown> = {}) => {
  const alarmListeners: Array<(alarm: { name: string }) => void> = [];
  const sessionValues: Record<string, unknown> = {};
  const chromeApi = {
    alarms: {
      create: vi.fn(),
      get: vi.fn(async () => undefined),
      onAlarm: {
        addListener: vi.fn((listener: (alarm: { name: string }) => void) => {
          alarmListeners.push(listener);
        }),
      },
    },
    runtime: { onInstalled: { addListener: vi.fn() } },
    storage: {
      session: {
        get: vi.fn(async (key: string) => ({ [key]: sessionValues[key] })),
        set: vi.fn(async (values: Record<string, unknown>) => Object.assign(sessionValues, values)),
      },
    },
    tabs: {
      query: vi.fn(async () => [{ id: 3 }, { id: 9 }]),
      sendMessage: vi.fn(async () => undefined),
    },
  };
  const readHealth = vi.fn(async () => REPORT);
  const invalidateHealth = vi.fn();
  const runtime = runtimeModule.create({
    chromeApi,
    readHealth,
    invalidateHealth,
    targetMatchPatterns: PATTERNS,
    log: vi.fn(),
    ...overrides,
  });
  return { runtime, chromeApi, readHealth, invalidateHealth, alarmListeners };
};

describe('health heartbeat runtime (extension)', () => {
  it('registra la alarma periódica y empuja el reporte en cada latido', async () => {
    const { runtime, chromeApi, alarmListeners } = createFixture();

    expect(runtime.start()).toBe(true);
    await vi.waitFor(() =>
      expect(chromeApi.alarms.create).toHaveBeenCalledWith('hhr-health-heartbeat', {
        periodInMinutes: 1,
      })
    );

    alarmListeners.forEach(listener => listener({ name: 'hhr-health-heartbeat' }));
    await vi.waitFor(() => expect(chromeApi.tabs.sendMessage).toHaveBeenCalledTimes(2));
    expect(chromeApi.tabs.query).toHaveBeenCalledWith({ url: PATTERNS });
    expect(chromeApi.tabs.sendMessage).toHaveBeenCalledWith(3, {
      type: runtimeModule.HEALTH_PUSH_MESSAGE_TYPE,
      report: REPORT,
      reason: 'heartbeat',
      publicationSequence: 1,
    });
  });

  it('ignora alarmas ajenas y tolera pestañas sin content script', async () => {
    const { runtime, chromeApi, alarmListeners, readHealth } = createFixture();
    runtime.start();
    alarmListeners.forEach(listener => listener({ name: 'otra-alarma' }));
    await Promise.resolve();
    expect(readHealth).not.toHaveBeenCalled();

    chromeApi.tabs.sendMessage.mockRejectedValueOnce(new Error('sin content script'));
    await expect(runtime.pushNow('gc-captured')).resolves.toEqual({ pushed: 1 });
  });

  it('invalida una lectura anterior antes de publicar cada transición', async () => {
    const { runtime, readHealth, invalidateHealth } = createFixture();

    await runtime.pushNow('source-tab-updated');

    expect(invalidateHealth).toHaveBeenCalledTimes(1);
    expect(invalidateHealth.mock.invocationCallOrder[0]).toBeLessThan(
      readHealth.mock.invocationCallOrder[0]
    );
  });

  it('suppresses a stale probe that completes after a newer health publication', async () => {
    const releases: Array<(value: unknown) => void> = [];
    const readHealth = vi.fn(
      () =>
        new Promise(resolve => {
          releases.push(resolve);
        })
    );
    const { runtime, chromeApi } = createFixture({ readHealth });

    const stalePush = runtime.pushNow('heartbeat');
    await vi.waitFor(() => expect(readHealth).toHaveBeenCalledTimes(1));
    const freshPush = runtime.pushNow('source-tab-updated');
    await vi.waitFor(() => expect(readHealth).toHaveBeenCalledTimes(2));

    releases[1]?.({ checkedAt: 'fresh' });
    await expect(freshPush).resolves.toEqual({ pushed: 2 });
    releases[0]?.({ checkedAt: 'stale' });
    await expect(stalePush).resolves.toEqual({ pushed: 0 });

    expect(chromeApi.tabs.sendMessage).toHaveBeenCalledTimes(2);
    expect(chromeApi.tabs.sendMessage).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ report: { checkedAt: 'stale' } })
    );
  });

  it('no recrea una alarma existente: el despertar del worker no reinicia el contador', async () => {
    const { runtime, chromeApi } = createFixture();
    chromeApi.alarms.get.mockResolvedValue({ name: 'hhr-health-heartbeat' } as never);

    expect(runtime.start()).toBe(true);
    await vi.waitFor(() => expect(chromeApi.alarms.get).toHaveBeenCalled());
    expect(chromeApi.alarms.create).not.toHaveBeenCalled();

    // onInstalled sí la recrea (punto seguro para tomar cambios de período).
    const installedListener = (
      chromeApi.runtime.onInstalled.addListener as ReturnType<typeof vi.fn>
    ).mock.calls[0]?.[0] as () => void;
    installedListener();
    await vi.waitFor(() => expect(chromeApi.alarms.create).toHaveBeenCalledTimes(1));
  });

  it('sin permiso de alarms no arranca, pero pushNow sigue disponible', async () => {
    const { runtime } = createFixture({
      chromeApi: {
        tabs: {
          query: vi.fn(async () => []),
          sendMessage: vi.fn(),
        },
      },
    });
    expect(runtime.start()).toBe(false);
    await expect(runtime.pushNow('manual')).resolves.toEqual({ pushed: 0 });
  });

  it('pushAfter conserva el resultado y el error del handler y empuja al terminar', async () => {
    const { runtime, chromeApi } = createFixture();
    const wrapped = runtime.pushAfter(async () => ({ ok: true }), 'gc-captured');
    await expect(wrapped()).resolves.toEqual({ ok: true });
    await vi.waitFor(() => expect(chromeApi.tabs.sendMessage).toHaveBeenCalled());

    const failing = runtime.pushAfter(async () => {
      throw new Error('captura rechazada');
    }, 'gc-captured');
    await expect(failing()).rejects.toThrow('captura rechazada');
    // El push posterior ocurre igual: el estado (p. ej. rechazo) también es noticia.
    await vi.waitFor(() => expect(chromeApi.tabs.sendMessage.mock.calls.length).toBeGreaterThan(2));
  });

  it('pushAfter publishes a directed report without replacing it with a global read', async () => {
    const { runtime, chromeApi, readHealth, invalidateHealth } = createFixture();
    const directedReport = { version: '0.48.23', gestionCamas: { status: 'ready', tabId: 42 } };
    const wrapped = runtime.pushAfter(
      async () => ({ ok: true, report: directedReport }),
      'connection-repair',
      result => (result as { report: unknown }).report
    );

    await expect(wrapped()).resolves.toEqual({ ok: true, report: directedReport });
    await vi.waitFor(() => expect(chromeApi.tabs.sendMessage).toHaveBeenCalledTimes(2));

    expect(readHealth).not.toHaveBeenCalled();
    expect(invalidateHealth).toHaveBeenCalledTimes(1);
    expect(chromeApi.tabs.sendMessage).toHaveBeenCalledWith(3, {
      type: runtimeModule.HEALTH_PUSH_MESSAGE_TYPE,
      report: directedReport,
      reason: 'connection-repair',
      publicationSequence: 1,
    });
  });

  it('persiste un orden monotónico entre instancias del service worker', async () => {
    const { runtime, chromeApi } = createFixture();
    await runtime.pushNow('heartbeat');

    const restartedRuntime = runtimeModule.create({
      chromeApi,
      readHealth: vi.fn(async () => REPORT),
      targetMatchPatterns: PATTERNS,
      log: vi.fn(),
    });
    await restartedRuntime.pushNow('worker-restarted');

    expect(chromeApi.tabs.sendMessage).toHaveBeenLastCalledWith(
      9,
      expect.objectContaining({ publicationSequence: 2, reason: 'worker-restarted' })
    );
  });
});
