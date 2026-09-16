import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  RAYEN_EXTENSION_HEALTH_LEASE_MS,
  RAYEN_EXTENSION_LEGACY_REFRESH_MS,
  useRayenExtensionHealth,
} from '@/features/rayen-import/hooks/useRayenExtensionHealth';
import {
  RAYEN_EXTENSION_PROTOCOL_VERSION,
  RAYEN_HEALTH_PUSH_CAPABILITY,
  type RayenExtensionHealthCheck,
  type RayenExtensionHealthReport,
} from '@/features/rayen-import/bridge/extensionHealthBridge';

const mocks = vi.hoisted(() => ({
  requestHealth: vi.fn(),
}));

vi.mock('@/features/rayen-import/bridge/extensionHealthBridge', async importOriginal => {
  const actual =
    await importOriginal<typeof import('@/features/rayen-import/bridge/extensionHealthBridge')>();
  return { ...actual, requestRayenExtensionHealth: mocks.requestHealth };
});

const makeReport = (
  overrides: Partial<RayenExtensionHealthReport> = {}
): RayenExtensionHealthReport => ({
  version: '0.6.0',
  protocolVersion: RAYEN_EXTENSION_PROTOCOL_VERSION,
  capabilities: [RAYEN_HEALTH_PUSH_CAPABILITY],
  checkedAt: new Date().toISOString(),
  fichaMedico: { status: 'ready', message: 'Ficha Médico disponible.' },
  gestionCamas: { status: 'ready', message: 'Gestión de Camas disponible.' },
  ...overrides,
});

describe('useRayenExtensionHealth legacy refresh', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renueva una extensión protocol v5 sin health-push antes de vencer el lease', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-15T12:00:00.000Z'));
    try {
      mocks.requestHealth.mockImplementation(() =>
        Promise.resolve({
          report: makeReport({ checkedAt: new Date().toISOString(), capabilities: [] }),
        } satisfies RayenExtensionHealthCheck)
      );
      const view = renderHook(() => useRayenExtensionHealth());
      await act(async () => Promise.resolve());
      expect(view.result.current.connection).toBe('ready');
      expect(view.result.current.canSync).toBe(true);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(RAYEN_EXTENSION_LEGACY_REFRESH_MS + 1);
      });
      expect(mocks.requestHealth).toHaveBeenCalledTimes(2);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(
          RAYEN_EXTENSION_HEALTH_LEASE_MS - RAYEN_EXTENSION_LEGACY_REFRESH_MS
        );
      });
      expect(view.result.current.connection).toBe('ready');
      expect(view.result.current.canSync).toBe(true);
      view.unmount();
    } finally {
      vi.useRealTimers();
    }
  });

  it('no duplica el latido activo con sondeos preventivos de compatibilidad', async () => {
    vi.useFakeTimers();
    try {
      mocks.requestHealth.mockResolvedValue({ report: makeReport() });
      const view = renderHook(() => useRayenExtensionHealth());
      await act(async () => Promise.resolve());

      await act(async () => {
        await vi.advanceTimersByTimeAsync(RAYEN_EXTENSION_LEGACY_REFRESH_MS + 1);
      });

      expect(mocks.requestHealth).toHaveBeenCalledTimes(1);
      expect(view.result.current.connection).toBe('ready');
      expect(view.result.current.canSync).toBe(true);
      view.unmount();
    } finally {
      vi.useRealTimers();
    }
  });

  it('no entra en sondeo continuo si una extensión antigua repite checkedAt', async () => {
    vi.useFakeTimers();
    const fixedCheckedAt = new Date().toISOString();
    try {
      mocks.requestHealth.mockResolvedValue({
        report: makeReport({ checkedAt: fixedCheckedAt, capabilities: [] }),
      });
      const view = renderHook(() => useRayenExtensionHealth());
      await act(async () => Promise.resolve());

      await act(async () => {
        await vi.advanceTimersByTimeAsync(RAYEN_EXTENSION_LEGACY_REFRESH_MS + 1_000);
      });

      expect(mocks.requestHealth).toHaveBeenCalledTimes(2);
      view.unmount();
    } finally {
      vi.useRealTimers();
    }
  });
});
