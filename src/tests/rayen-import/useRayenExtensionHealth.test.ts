import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  deriveHealthState,
  expireRayenExtensionHealthState,
  RAYEN_EXTENSION_HEALTH_LEASE_MS,
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
  checkedAt: new Date().toISOString(),
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

  it('bloquea el arranque cuando la sesión de Gestión de Camas está por vencer', () => {
    const expiring = deriveHealthState(
      makeReport({
        gestionCamas: {
          status: 'ready',
          message: 'Gestión de Camas conectada; la sesión vencerá pronto.',
          remainingSeconds: 120,
          expiring: true,
        },
      })
    );
    expectConnection(expiring, 'blocked', false);
    expect(expiring.blockedBy).toBe('gestionCamas');
    expect(expiring.message).toContain('vence en ~2 min');
    expect(expiring.message).toContain('Renuévala');
    expect(
      deriveHealthState(
        makeReport({
          gestionCamas: { status: 'missing', message: 'Gestión de Camas no está abierta.' },
        })
      ).blockedBy
    ).toBe('gestionCamas');
    expect(
      deriveHealthState(
        makeReport({ fichaMedico: { status: 'stale', message: 'Recarga Ficha Médico.' } })
      ).blockedBy
    ).toBe('fichaMedico');
  });

  it('bloquea el arranque cuando la sesión de Ficha Médico está por vencer (extensión ≥ 0.48.5)', () => {
    // Eloísa da sesiones de 24 h que vencen a hora fija (medido: 08:28), en
    // plena mañana de censo; antes la vigencia de Ficha Médico ni se publicaba.
    const expiring = deriveHealthState(
      makeReport({
        fichaMedico: {
          status: 'ready',
          message: 'Ficha Médico disponible. Sesión clínica vigente.',
          remainingSeconds: 150,
        },
      })
    );
    expectConnection(expiring, 'blocked', false);
    expect(expiring.blockedBy).toBe('fichaMedico');
    expect(expiring.message).toContain('Ficha Médico vence en ~3 min');
    expect(expiring.message).toContain('iniciar sesión en Eloísa');

    // Ya vencida: el mensaje no dice «vence en ~1 min».
    const expired = deriveHealthState(
      makeReport({
        fichaMedico: {
          status: 'ready',
          message: 'Ficha Médico disponible. Sesión clínica vigente.',
          remainingSeconds: 0,
        },
      })
    );
    expectConnection(expired, 'blocked', false);
    expect(expired.message).toContain('La sesión de Ficha Médico venció');

    expectConnection(
      deriveHealthState(
        makeReport({
          fichaMedico: {
            status: 'ready',
            message: 'Ficha Médico disponible. Sesión clínica vigente.',
            remainingSeconds: 23 * 3600,
          },
        })
      ),
      'ready',
      true
    );
  });

  it('permite sincronizar con vigencia holgada o sin expiración informada', () => {
    expectConnection(
      deriveHealthState(
        makeReport({
          gestionCamas: {
            status: 'ready',
            message: 'Gestión de Camas conectada con sesión vigente.',
            remainingSeconds: 1800,
          },
        })
      ),
      'ready',
      true
    );
    expectConnection(
      deriveHealthState(
        makeReport({
          gestionCamas: {
            status: 'ready',
            message: 'Gestión de Camas conectada.',
            remainingSeconds: null,
          },
        })
      ),
      'ready',
      true
    );
  });

  it('deja de confiar en un reporte que perdió más de dos latidos', () => {
    const now = Date.parse('2026-09-03T12:00:00.000Z');
    const fresh = deriveHealthState(
      makeReport({ checkedAt: new Date(now - RAYEN_EXTENSION_HEALTH_LEASE_MS + 1).toISOString() })
    );
    expect(expireRayenExtensionHealthState(fresh, now)).toBe(fresh);

    const expired = expireRayenExtensionHealthState(
      deriveHealthState(
        makeReport({ checkedAt: new Date(now - RAYEN_EXTENSION_HEALTH_LEASE_MS).toISOString() })
      ),
      now
    );
    expectConnection(expired, 'offline', false);
    expect(expired.message).toContain('dejó de actualizarse');
    expect(expired.report?.fichaMedico.status).toBe('stale');
    expect(expired.report?.gestionCamas.status).toBe('stale');
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

  it('adopta el estado empujado por la extensión y le da prioridad sobre chequeos en vuelo', async () => {
    let resolvePassive!: (value: RayenExtensionHealthCheck) => void;
    mocks.requestHealth.mockImplementationOnce(
      () => new Promise<RayenExtensionHealthCheck>(resolve => (resolvePassive = resolve))
    );

    const { result } = renderHook(() => useRayenExtensionHealth());
    expect(result.current.connection).toBe('checking');

    await act(async () => {
      window.dispatchEvent(
        new MessageEvent('message', {
          origin: window.location.origin,
          data: {
            type: 'HHR_RAYEN_EXTENSION_HEALTH_PUSH',
            report: makeReport(),
            reason: 'heartbeat',
          },
        })
      );
      await Promise.resolve();
    });
    expect(result.current.connection).toBe('ready');
    expect(result.current.canSync).toBe(true);

    // El chequeo pasivo que quedó en vuelo NO pisa el push más fresco.
    await act(async () => {
      resolvePassive({ report: null, error: 'Respuesta pasiva obsoleta.' });
      await Promise.resolve();
    });
    expect(result.current.connection).toBe('ready');
  });

  it('vence automáticamente la señal y consulta de nuevo al volver a primer plano o recuperar red', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-03T12:00:00.000Z'));
    try {
      mocks.requestHealth.mockResolvedValue({ report: makeReport() });
      const { result } = renderHook(() => useRayenExtensionHealth());
      await act(async () => Promise.resolve());
      expect(result.current.connection).toBe('ready');

      await act(async () => {
        await vi.advanceTimersByTimeAsync(RAYEN_EXTENSION_HEALTH_LEASE_MS + 20);
      });
      expectConnection(result.current, 'offline', false);

      Object.defineProperty(document, 'hidden', { configurable: true, value: false });
      await act(async () => {
        document.dispatchEvent(new Event('visibilitychange'));
        window.dispatchEvent(new Event('online'));
        await vi.advanceTimersByTimeAsync(101);
      });
      expect(mocks.requestHealth).toHaveBeenCalledTimes(2);
      expect(result.current.connection).toBe('ready');
    } finally {
      vi.useRealTimers();
    }
  });
});
