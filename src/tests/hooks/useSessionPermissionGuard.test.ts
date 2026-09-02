import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
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

vi.mock('@/services/observability/operationalTelemetryRecorder', () => ({
  recordOperationalTelemetry: vi.fn(),
}));

const user = { uid: 'u1', email: 'u1@hospital.test', role: 'nurse' } as unknown as AuthUser;
const unauthenticated = { status: 'unauthenticated', user: null } as AuthSessionState;
const authorized = { status: 'authorized', user } as unknown as AuthSessionState;

/** Aplica el último updater funcional pasado al setter sobre un estado dado. */
const applyLastUpdate = (setSessionState: ReturnType<typeof vi.fn>, current: AuthSessionState) => {
  const last = setSessionState.mock.calls.at(-1)?.[0];
  return typeof last === 'function' ? last(current) : last;
};

const storm = async () => {
  await act(async () => {
    reportBasicReadPermissionDenied('records:subscribeToRecord', 1_000);
    reportBasicReadPermissionDenied('catalog:nurse catalog', 2_000);
  });
};

describe('useSessionPermissionGuard', () => {
  beforeEach(() => {
    resetSessionPermissionStormDetector();
    resetSessionPermissionGuardForTests();
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
      reportBasicReadPermissionDenied('records:subscribeToRecord', 1_000);
    });
    // El bootstrap emite un segundo 'authorized' con otro objeto → handleLogout nuevo.
    const secondLogout = vi.fn().mockResolvedValue(undefined);
    rerender({ logout: secondLogout });
    await act(async () => {
      reportBasicReadPermissionDenied('catalog:nurse catalog', 2_000);
    });

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
