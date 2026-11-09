import { act, renderHook } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  resetSessionPermissionGuardForTests,
  SESSION_PERMISSIONS_LOST_MESSAGE,
  useSessionPermissionGuard,
} from '@/hooks/useSessionPermissionGuard';
import { SESSION_PERMISSION_STORM_CAUSE } from '@/hooks/controllers/authBootstrapController';
import {
  reportBasicReadPermissionDenied,
  resetSessionPermissionStormDetector,
} from '@/services/auth/sessionPermissionStormDetector';
import type { AuthSessionState } from '@/types/authSessionTypes';
import type { AuthUser } from '@/types/authRoleTypes';
import { recordOperationalTelemetry } from '@/services/observability/operationalTelemetryRecorder';

const probe = vi.hoisted(() => ({
  outcome: 'denied' as 'readable' | 'denied' | 'timeout' | 'failed',
  recent: false,
  mark: true,
  calls: 0,
}));
const reload = vi.hoisted(() => vi.fn());

vi.mock('@/services/observability/operationalTelemetryRecorder', () => ({
  recordOperationalTelemetry: vi.fn(),
}));
vi.mock('@/services/auth/sessionPermissionProbe', () => ({
  probeSessionReadPermission: async () => {
    probe.calls += 1;
    return probe.outcome;
  },
  hasRecentRecoveryReload: () => probe.recent,
  markRecoveryReload: () => probe.mark,
}));
vi.mock('@/shared/runtime/browserWindowRuntimeCore', () => ({
  defaultBrowserWindowRuntime: { reload },
}));

const user = { uid: 'u1', email: 'u1@hospital.test', role: 'nurse' } as unknown as AuthUser;
const unauthenticated = { status: 'unauthenticated', user: null } as AuthSessionState;
const authorized = { status: 'authorized', user } as unknown as AuthSessionState;

/** Aplica el último updater funcional pasado al setter sobre un estado dado. */
const applyLastUpdate = (setSessionState: ReturnType<typeof vi.fn>, current: AuthSessionState) => {
  const last = setSessionState.mock.calls.at(-1)?.[0];
  return typeof last === 'function' ? last(current) : last;
};

/** The verdict waits for a lazy module and the probe: let every pending promise settle. */
const settle = async () => {
  await act(async () => {
    for (let i = 0; i < 5; i += 1) await new Promise(resolve => setTimeout(resolve, 0));
  });
};

const storm = async () => {
  await act(async () => {
    reportBasicReadPermissionDenied('records:subscribeToRecord', {
      now: 1_000,
      error: { code: 'permission-denied' },
    });
    reportBasicReadPermissionDenied('catalog:nurse catalog', {
      now: 2_000,
      error: { code: 'unauthenticated' },
    });
  });
  await settle();
};

const telemetryOperations = () =>
  vi.mocked(recordOperationalTelemetry).mock.calls.map(([event]) => event.operation);

describe('useSessionPermissionGuard', () => {
  // The verdict is a lazy module: load it once so each storm settles within a few ticks.
  beforeAll(async () => {
    await import('@/services/auth/sessionPermissionStormVerdict');
  });

  beforeEach(() => {
    resetSessionPermissionStormDetector();
    resetSessionPermissionGuardForTests();
    Object.assign(probe, { outcome: 'denied', recent: false, mark: true, calls: 0 });
    reload.mockReset();
    vi.mocked(recordOperationalTelemetry).mockReset();
  });

  it('una denegación pasajera se recupera en silencio: sin logout, una recarga y telemetría de recuperación', async () => {
    probe.outcome = 'readable';
    const handleLogout = vi.fn().mockResolvedValue(undefined);
    const setSessionState = vi.fn();
    renderHook(() => useSessionPermissionGuard(user, handleLogout, setSessionState));

    await storm();

    expect(handleLogout).not.toHaveBeenCalled();
    expect(setSessionState).not.toHaveBeenCalled();
    expect(reload).toHaveBeenCalledTimes(1);
    expect(telemetryOperations()).toEqual(['session_permission_storm_recovered']);
    expect(vi.mocked(recordOperationalTelemetry).mock.calls[0]?.[0].context).toMatchObject({
      count: 2,
      catalogDenialCount: 1,
      recordDenialCount: 1,
      errorCode: 'unauthenticated',
      mixedDenialCodes: true,
      probeOutcome: 'readable',
    });
  });

  it.each(['denied', 'timeout', 'failed'] as const)(
    'si la lectura de prueba termina en %s cierra sesión como siempre y no recarga',
    async outcome => {
      probe.outcome = outcome;
      const handleLogout = vi.fn().mockResolvedValue(undefined);
      renderHook(() => useSessionPermissionGuard(user, handleLogout, vi.fn()));

      await storm();

      expect(handleLogout).toHaveBeenCalledWith('automatic');
      expect(reload).not.toHaveBeenCalled();
      expect(telemetryOperations()).toEqual(['session_permission_storm_logout']);
      expect(vi.mocked(recordOperationalTelemetry).mock.calls[0]?.[0].context).toMatchObject({
        probeOutcome: outcome,
      });
    }
  );

  it('otra tormenta poco después de una recarga de recuperación cierra sesión sin volver a probar', async () => {
    probe.outcome = 'readable';
    probe.recent = true;
    const handleLogout = vi.fn().mockResolvedValue(undefined);
    renderHook(() => useSessionPermissionGuard(user, handleLogout, vi.fn()));

    await storm();

    expect(probe.calls).toBe(0);
    expect(reload).not.toHaveBeenCalled();
    expect(handleLogout).toHaveBeenCalledWith('automatic');
  });

  it('si no se puede marcar la recarga (almacenamiento bloqueado) cierra sesión en vez de arriesgar un bucle', async () => {
    probe.outcome = 'readable';
    probe.mark = false;
    const handleLogout = vi.fn().mockResolvedValue(undefined);
    renderHook(() => useSessionPermissionGuard(user, handleLogout, vi.fn()));

    await storm();

    expect(reload).not.toHaveBeenCalled();
    expect(handleLogout).toHaveBeenCalledWith('automatic');
  });

  it('ante una tormenta cierra sesión por la ruta automática y deja la razón marcada con su causa', async () => {
    const handleLogout = vi.fn().mockResolvedValue(undefined);
    const setSessionState = vi.fn();
    renderHook(() => useSessionPermissionGuard(user, handleLogout, setSessionState));

    await storm();

    expect(handleLogout).toHaveBeenCalledWith('automatic');
    const next = applyLastUpdate(setSessionState, unauthenticated);
    expect(next).toMatchObject({
      status: 'unauthorized',
      reason: SESSION_PERMISSIONS_LOST_MESSAGE,
      technicalContext: { cause: SESSION_PERMISSION_STORM_CAUSE },
    });
  });

  it('la razón solo se aplica sobre la sesión que se cierra: nunca sobre un unauthorized ajeno', async () => {
    const setSessionState = vi.fn();
    renderHook(() =>
      useSessionPermissionGuard(user, vi.fn().mockResolvedValue(undefined), setSessionState)
    );

    await storm();

    const foreign = {
      status: 'unauthorized',
      user: null,
      reason: 'role_not_resolved',
    } as AuthSessionState;
    expect(applyLastUpdate(setSessionState, foreign)).toBe(foreign);
    expect(applyLastUpdate(setSessionState, authorized)).toMatchObject({ status: 'unauthorized' });
  });

  it('no espera la promesa del logout: la razón se fija aunque el logout tarde (setDoc de auditoría pendiente)', async () => {
    let resolveLogout: () => void = () => {};
    const handleLogout = vi.fn(
      () =>
        new Promise<void>(resolve => {
          resolveLogout = resolve;
        })
    );
    const setSessionState = vi.fn();
    renderHook(() => useSessionPermissionGuard(user, handleLogout, setSessionState));

    await storm();

    expect(setSessionState).toHaveBeenCalled();
    resolveLogout();
  });

  it('con varias instancias del hook el logout corre UNA vez y cada instancia deja su razón', async () => {
    const handleLogoutA = vi.fn().mockResolvedValue(undefined);
    const handleLogoutB = vi.fn().mockResolvedValue(undefined);
    const setA = vi.fn();
    const setB = vi.fn();
    renderHook(() => useSessionPermissionGuard(user, handleLogoutA, setA));
    renderHook(() => useSessionPermissionGuard(user, handleLogoutB, setB));

    await storm();

    expect(probe.calls).toBe(1);
    expect(handleLogoutA.mock.calls.length + handleLogoutB.mock.calls.length).toBe(1);
    expect(setA).toHaveBeenCalled();
    expect(setB).toHaveBeenCalled();
  });

  it('re-renderizar con un handleLogout nuevo (mismo uid) no borra las denegaciones ya acumuladas', async () => {
    const setSessionState = vi.fn();
    const { rerender } = renderHook(
      ({ logout }: { logout: () => Promise<void> }) =>
        useSessionPermissionGuard(user, logout, setSessionState),
      { initialProps: { logout: vi.fn().mockResolvedValue(undefined) } }
    );

    await act(async () => {
      reportBasicReadPermissionDenied('records:subscribeToRecord', { now: 1_000 });
    });
    // El bootstrap emite un segundo 'authorized' con otro objeto → handleLogout nuevo.
    const secondLogout = vi.fn().mockResolvedValue(undefined);
    rerender({ logout: secondLogout });
    await act(async () => {
      reportBasicReadPermissionDenied('catalog:nurse catalog', { now: 2_000 });
    });
    await settle();

    expect(secondLogout).toHaveBeenCalledWith('automatic');
  });

  it('sin usuario autenticado no escucha nada', async () => {
    const handleLogout = vi.fn().mockResolvedValue(undefined);
    const setSessionState = vi.fn();
    renderHook(() => useSessionPermissionGuard(null, handleLogout, setSessionState));

    await storm();

    expect(handleLogout).not.toHaveBeenCalled();
    expect(setSessionState).not.toHaveBeenCalled();
  });

  it('al desmontar deja de escuchar', async () => {
    const handleLogout = vi.fn().mockResolvedValue(undefined);
    const { unmount } = renderHook(() => useSessionPermissionGuard(user, handleLogout, vi.fn()));
    unmount();

    await storm();

    expect(handleLogout).not.toHaveBeenCalled();
  });
});
