import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  deriveHealthState,
  useRayenExtensionHealth,
  type RayenExtensionHealthState,
} from '@/features/rayen-import/hooks/useRayenExtensionHealth';
import {
  RAYEN_EXTENSION_PROTOCOL_VERSION,
  RAYEN_EXTENSION_SYNC_HEALTH_TIMEOUT_MS,
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
  checkedAt: '2026-07-14T05:00:00.000Z',
  fichaMedico: { status: 'ready', message: 'Ficha Médico disponible.' },
  gestionCamas: { status: 'ready', message: 'Gestión de Camas disponible.' },
  ...overrides,
});

const expectConnection = (
  state: RayenExtensionHealthState,
  connection: RayenExtensionHealthState['connection'],
  canSync: boolean
): void => {
  expect(state.connection).toBe(connection);
  expect(state.canSync).toBe(canSync);
};

describe('deriveHealthState', () => {
  beforeEach(() => vi.clearAllMocks());

  it('requires both Rayen sources before allowing synchronization', () => {
    expectConnection(deriveHealthState(makeReport()), 'ready', true);
    expectConnection(
      deriveHealthState(
        makeReport({
          gestionCamas: { status: 'missing', message: 'Gestión de Camas no está abierta.' },
        })
      ),
      'blocked',
      false
    );
    expectConnection(
      deriveHealthState(
        makeReport({
          fichaMedico: { status: 'stale', message: 'Recarga Ficha Médico.' },
        })
      ),
      'blocked',
      false
    );
    expectConnection(deriveHealthState(makeReport({ protocolVersion: 1 })), 'incompatible', false);
    expectConnection(deriveHealthState(null, 'Sin extensión.'), 'offline', false);
  });
});

describe('useRayenExtensionHealth', () => {
  beforeEach(() => vi.clearAllMocks());

  it('keeps the latest active result when an earlier passive check answers late', async () => {
    let resolvePassive!: (value: RayenExtensionHealthCheck) => void;
    let resolveActive!: (value: RayenExtensionHealthCheck) => void;
    mocks.requestHealth
      .mockImplementationOnce(
        () => new Promise<RayenExtensionHealthCheck>(resolve => (resolvePassive = resolve))
      )
      .mockImplementationOnce(
        () => new Promise<RayenExtensionHealthCheck>(resolve => (resolveActive = resolve))
      );

    const { result } = renderHook(() => useRayenExtensionHealth());
    let activeRequest!: Promise<RayenExtensionHealthState>;
    act(() => {
      activeRequest = result.current.refresh({
        timeoutMs: RAYEN_EXTENSION_SYNC_HEALTH_TIMEOUT_MS,
      });
    });

    expect(mocks.requestHealth).toHaveBeenNthCalledWith(1);
    expect(mocks.requestHealth).toHaveBeenNthCalledWith(2, RAYEN_EXTENSION_SYNC_HEALTH_TIMEOUT_MS);

    await act(async () => {
      resolveActive({ report: makeReport() });
      await activeRequest;
    });
    expect(result.current.connection).toBe('ready');

    await act(async () => {
      resolvePassive({ report: null, error: 'Respuesta pasiva obsoleta.' });
      await Promise.resolve();
    });
    expect(result.current.connection).toBe('ready');
    expect(result.current.message).toContain('operativa');
  });
});
