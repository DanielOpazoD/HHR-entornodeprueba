import { mocks, makeReport, expectConnection } from './support/extensionHealthHarness';
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  useRayenExtensionHealth,
  type RayenExtensionHealthState,
} from '@/features/rayen-import/hooks/useRayenExtensionHealth';
import {
  RAYEN_EXTENSION_PASSIVE_HEALTH_TIMEOUT_MS,
  RAYEN_EXTENSION_SYNC_HEALTH_TIMEOUT_MS,
  type RayenExtensionHealthCheck,
} from '@/features/rayen-import/bridge/extensionHealthBridge';

describe('useRayenExtensionHealth synchronization preflight', () => {
  beforeEach(() => vi.clearAllMocks());

  it('lets a 20-second preflight finish without a shorter focus refresh cancelling it', async () => {
    vi.useFakeTimers();
    try {
      mocks.requestHealth.mockResolvedValueOnce({ report: makeReport() }).mockImplementation(
        (
          timeoutMs = RAYEN_EXTENSION_PASSIVE_HEALTH_TIMEOUT_MS,
          options?: { verifySessions?: boolean }
        ) =>
          new Promise<RayenExtensionHealthCheck>(resolve => {
            setTimeout(
              () =>
                resolve(
                  options?.verifySessions
                    ? { report: makeReport() }
                    : { report: null, error: 'Timeout pasivo.' }
                ),
              options?.verifySessions ? 20_000 : timeoutMs
            );
          })
      );
      const view = renderHook(() => useRayenExtensionHealth());
      await act(async () => Promise.resolve());
      let pending!: Promise<RayenExtensionHealthState>;
      act(() => {
        pending = view.result.current.refresh({
          showChecking: true,
          timeoutMs: RAYEN_EXTENSION_SYNC_HEALTH_TIMEOUT_MS,
        });
      });
      window.dispatchEvent(new Event('focus'));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(20_000);
      });
      expect((await pending).canSync).toBe(true);
      expectConnection(view.result.current, 'ready', true);
      expect(mocks.requestHealth).toHaveBeenCalledTimes(2);

      mocks.requestHealth.mockResolvedValueOnce({ report: makeReport() });
      window.dispatchEvent(new Event('focus'));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(101);
      });
      expect(mocks.requestHealth).toHaveBeenCalledTimes(3);
      view.unmount();
    } finally {
      vi.useRealTimers();
    }
  });

  it('ignores the shorter timeout of a passive check that started before the active preflight', async () => {
    vi.useFakeTimers();
    try {
      mocks.requestHealth.mockImplementation(
        (
          timeoutMs = RAYEN_EXTENSION_PASSIVE_HEALTH_TIMEOUT_MS,
          options?: { verifySessions?: boolean }
        ) =>
          new Promise<RayenExtensionHealthCheck>(resolve => {
            setTimeout(
              () =>
                resolve(
                  options?.verifySessions
                    ? { report: makeReport() }
                    : { report: null, error: 'Timeout pasivo anterior.' }
                ),
              options?.verifySessions ? 20_000 : timeoutMs
            );
          })
      );
      const view = renderHook(() => useRayenExtensionHealth());
      let pending!: Promise<RayenExtensionHealthState>;
      act(() => {
        pending = view.result.current.refresh({
          showChecking: true,
          timeoutMs: RAYEN_EXTENSION_SYNC_HEALTH_TIMEOUT_MS,
        });
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10_000);
      });
      expectConnection(view.result.current, 'checking', false);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10_000);
      });
      expect((await pending).canSync).toBe(true);
      expectConnection(view.result.current, 'ready', true);
      expect(mocks.requestHealth).toHaveBeenCalledTimes(2);
      view.unmount();
    } finally {
      vi.useRealTimers();
    }
  });

  it.each(['push', 'repair'])(
    'does not authorize an old green preflight after a newer %s reported disconnection',
    async channel => {
      let resolvePreflight!: (value: RayenExtensionHealthCheck) => void;
      mocks.requestHealth.mockResolvedValueOnce({ report: makeReport() }).mockImplementationOnce(
        () =>
          new Promise<RayenExtensionHealthCheck>(resolve => {
            resolvePreflight = resolve;
          })
      );
      const { result } = renderHook(() => useRayenExtensionHealth());
      await act(async () => Promise.resolve());
      let pending!: Promise<RayenExtensionHealthState>;
      act(() => {
        pending = result.current.refresh({ showChecking: true });
      });
      const disconnected = makeReport({
        gestionCamas: { status: 'stale', message: 'Sesión vencida.' },
      });
      act(() => {
        if (channel === 'repair') result.current.adoptReport(disconnected);
        else
          window.dispatchEvent(
            new MessageEvent('message', {
              origin: window.location.origin,
              source: window,
              data: { type: 'HHR_RAYEN_EXTENSION_HEALTH_PUSH', report: disconnected },
            })
          );
      });
      expectConnection(result.current, 'blocked', false);
      await act(async () => {
        resolvePreflight({ report: makeReport() });
        const returned = await pending;
        expect(returned.canSync).toBe(false);
      });
      expectConnection(result.current, 'blocked', false);
    }
  );

  it('keeps an invalidated preflight blocked even if passive polling restores green before it answers', async () => {
    let resolvePreflight!: (value: RayenExtensionHealthCheck) => void;
    mocks.requestHealth
      .mockResolvedValueOnce({ report: makeReport() })
      .mockImplementationOnce(
        () =>
          new Promise<RayenExtensionHealthCheck>(resolve => {
            resolvePreflight = resolve;
          })
      )
      .mockResolvedValueOnce({ report: makeReport({ syncPreflight: false }) });
    const { result } = renderHook(() => useRayenExtensionHealth());
    await act(async () => Promise.resolve());
    let pending!: Promise<RayenExtensionHealthState>;
    act(() => {
      pending = result.current.refresh({ showChecking: true });
    });
    act(() => {
      result.current.adoptReport(
        makeReport({ gestionCamas: { status: 'stale', message: 'Sin conexión.' } })
      );
    });
    await act(async () => {
      await result.current.refresh();
    });
    expectConnection(result.current, 'ready', true);

    await act(async () => {
      resolvePreflight({ report: makeReport() });
      expect((await pending).canSync).toBe(false);
    });
    expectConnection(result.current, 'blocked', false);
  });

  it.each([
    { channel: 'push', failure: 'stale', connection: 'blocked' },
    { channel: 'repair', failure: 'stale', connection: 'blocked' },
    { channel: 'push', failure: 'timeout', connection: 'offline' },
    { channel: 'repair', failure: 'timeout', connection: 'offline' },
  ] satisfies Array<{
    channel: 'push' | 'repair';
    failure: 'stale' | 'timeout';
    connection: RayenExtensionHealthState['connection'];
  }>)(
    'publishes the active $failure after a healthy $channel arrives during preflight',
    async ({ channel, failure, connection }) => {
      let resolvePreflight!: (value: RayenExtensionHealthCheck) => void;
      mocks.requestHealth.mockResolvedValueOnce({ report: makeReport() }).mockImplementationOnce(
        () =>
          new Promise<RayenExtensionHealthCheck>(resolve => {
            resolvePreflight = resolve;
          })
      );
      const { result } = renderHook(() => useRayenExtensionHealth());
      await act(async () => Promise.resolve());
      let pending!: Promise<RayenExtensionHealthState>;
      act(() => {
        pending = result.current.refresh({ showChecking: true });
      });
      act(() => {
        const report = makeReport({ syncPreflight: false });
        if (channel === 'repair') result.current.adoptReport(report);
        else
          window.dispatchEvent(
            new MessageEvent('message', {
              origin: window.location.origin,
              source: window,
              data: { type: 'HHR_RAYEN_EXTENSION_HEALTH_PUSH', report },
            })
          );
      });
      expectConnection(result.current, 'ready', true);
      await act(async () => {
        resolvePreflight(
          failure === 'timeout'
            ? { report: null, error: 'Tiempo de comprobación agotado.' }
            : {
                report: makeReport({
                  gestionCamas: { status: 'stale', message: 'La sesión venció.' },
                }),
              }
        );
        expectConnection(await pending, connection, false);
      });
      expectConnection(result.current, connection, false);
    }
  );

  it('accepts a verified preflight when a concurrent heartbeat remains healthy', async () => {
    let resolvePreflight!: (value: RayenExtensionHealthCheck) => void;
    mocks.requestHealth.mockResolvedValueOnce({ report: makeReport() }).mockImplementationOnce(
      () =>
        new Promise<RayenExtensionHealthCheck>(resolve => {
          resolvePreflight = resolve;
        })
    );
    const { result } = renderHook(() => useRayenExtensionHealth());
    await act(async () => Promise.resolve());
    let pending!: Promise<RayenExtensionHealthState>;
    act(() => {
      pending = result.current.refresh({ showChecking: true });
    });
    await act(async () => {
      window.dispatchEvent(
        new MessageEvent('message', {
          origin: window.location.origin,
          source: window,
          data: {
            type: 'HHR_RAYEN_EXTENSION_HEALTH_PUSH',
            report: makeReport({ syncPreflight: false }),
          },
        })
      );
      resolvePreflight({ report: makeReport() });
      expect((await pending).canSync).toBe(true);
    });
    expectConnection(result.current, 'ready', true);
  });

  it('does not authorize a preflight superseded by another active check', async () => {
    const releases: Array<(value: RayenExtensionHealthCheck) => void> = [];
    mocks.requestHealth
      .mockResolvedValueOnce({ report: makeReport() })
      .mockImplementation(
        () => new Promise<RayenExtensionHealthCheck>(resolve => releases.push(resolve))
      );
    const { result } = renderHook(() => useRayenExtensionHealth());
    await act(async () => Promise.resolve());
    let first!: Promise<RayenExtensionHealthState>;
    let second!: Promise<RayenExtensionHealthState>;
    act(() => {
      first = result.current.refresh({ showChecking: true });
    });
    act(() => {
      second = result.current.refresh({ showChecking: true });
    });
    await act(async () => {
      releases[0]?.({ report: makeReport() });
      expect((await first).canSync).toBe(false);
      releases[1]?.({ report: makeReport() });
      expect((await second).canSync).toBe(true);
    });
    expectConnection(result.current, 'ready', true);
  });

  it('does not authorize a preflight after its owner unmounts', async () => {
    let release!: (value: RayenExtensionHealthCheck) => void;
    mocks.requestHealth.mockResolvedValueOnce({ report: makeReport() }).mockImplementationOnce(
      () =>
        new Promise<RayenExtensionHealthCheck>(resolve => {
          release = resolve;
        })
    );
    const view = renderHook(() => useRayenExtensionHealth());
    await act(async () => Promise.resolve());
    let pending!: Promise<RayenExtensionHealthState>;
    act(() => {
      pending = view.result.current.refresh({ showChecking: true });
    });
    view.unmount();
    release({ report: makeReport() });
    expect((await pending).canSync).toBe(false);
  });

  it('mantiene visible una conexión sana durante refrescos pasivos y reserva checking al preflight', async () => {
    let resolvePassive!: (value: RayenExtensionHealthCheck) => void;
    let resolvePreflight!: (value: RayenExtensionHealthCheck) => void;
    mocks.requestHealth
      .mockResolvedValueOnce({ report: makeReport() })
      .mockImplementationOnce(
        () => new Promise<RayenExtensionHealthCheck>(resolve => (resolvePassive = resolve))
      )
      .mockImplementationOnce(
        () => new Promise<RayenExtensionHealthCheck>(resolve => (resolvePreflight = resolve))
      );

    const { result } = renderHook(() => useRayenExtensionHealth());
    await act(async () => Promise.resolve());
    expectConnection(result.current, 'ready', true);

    let passiveRefresh!: Promise<RayenExtensionHealthState>;
    act(() => {
      passiveRefresh = result.current.refresh();
    });
    expectConnection(result.current, 'ready', true);
    await act(async () => {
      resolvePassive({ report: makeReport() });
      await passiveRefresh;
    });

    let preflightRefresh!: Promise<RayenExtensionHealthState>;
    act(() => {
      preflightRefresh = result.current.refresh({ showChecking: true });
    });
    expectConnection(result.current, 'checking', false);
    await act(async () => {
      resolvePreflight({ report: makeReport() });
      await preflightRefresh;
    });
    expectConnection(result.current, 'ready', true);
  });

  it('does not reuse a recent green report when the synchronization preflight times out', async () => {
    mocks.requestHealth
      .mockResolvedValueOnce({ report: makeReport() })
      .mockResolvedValueOnce({ report: null, error: 'La extensión no respondió.' });
    const { result } = renderHook(() => useRayenExtensionHealth());
    await act(async () => Promise.resolve());
    expectConnection(result.current, 'ready', true);

    await act(async () => {
      const preflight = await result.current.refresh({ showChecking: true });
      expectConnection(preflight, 'offline', false);
    });
    expectConnection(result.current, 'offline', false);
    expect(mocks.requestHealth).toHaveBeenLastCalledWith(undefined, { verifySessions: true });
  });

  it('requires an extension that can verify source sessions before synchronization', async () => {
    mocks.requestHealth.mockResolvedValue({
      report: makeReport({ capabilities: ['health-push'] }),
    });
    const { result } = renderHook(() => useRayenExtensionHealth());
    await act(async () => Promise.resolve());

    await act(async () => {
      const preflight = await result.current.refresh({ showChecking: true });
      expectConnection(preflight, 'incompatible', false);
      expect(preflight.message).toContain('Actualiza');
    });
  });

  it('rejects a green response from an old relay that dropped active verification', async () => {
    mocks.requestHealth.mockResolvedValue({ report: makeReport({ syncPreflight: false }) });
    const { result } = renderHook(() => useRayenExtensionHealth());
    await act(async () => Promise.resolve());
    await act(async () => {
      const preflight = await result.current.refresh({ showChecking: true });
      expectConnection(preflight, 'incompatible', false);
      expect(preflight.message).toContain('Actualiza');
    });
  });
});
