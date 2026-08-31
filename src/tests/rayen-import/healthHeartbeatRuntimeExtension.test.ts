// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import '../../../extension/health-heartbeat-runtime.js';

type HeartbeatRuntime = {
  create: (deps: Record<string, unknown>) => {
    start: () => boolean;
    pushNow: (reason: string) => Promise<{ pushed: number }>;
    pushAfter: (
      handle: (...args: unknown[]) => unknown,
      reason: string
    ) => (...args: unknown[]) => Promise<unknown>;
  };
  HEALTH_PUSH_MESSAGE_TYPE: string;
};

const runtimeModule = (globalThis as unknown as { HhrHealthHeartbeatRuntime: HeartbeatRuntime })
  .HhrHealthHeartbeatRuntime;

const REPORT = { version: '0.48.0', gestionCamas: { status: 'ready' } };
const PATTERNS = ['http://localhost:3001/*'];

const createFixture = (overrides: Record<string, unknown> = {}) => {
  const alarmListeners: Array<(alarm: { name: string }) => void> = [];
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
    tabs: {
      query: vi.fn(async () => [{ id: 3 }, { id: 9 }]),
      sendMessage: vi.fn(async () => undefined),
    },
  };
  const readHealth = vi.fn(async () => REPORT);
  const runtime = runtimeModule.create({
    chromeApi,
    readHealth,
    hhrMatchPatterns: PATTERNS,
    log: vi.fn(),
    ...overrides,
  });
  return { runtime, chromeApi, readHealth, alarmListeners };
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
});
