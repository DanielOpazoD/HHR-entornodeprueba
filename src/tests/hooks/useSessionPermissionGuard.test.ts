import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  SESSION_PERMISSIONS_LOST_MESSAGE,
  useSessionPermissionGuard,
} from '@/hooks/useSessionPermissionGuard';
import {
  reportBasicReadPermissionDenied,
  resetSessionPermissionStormDetector,
} from '@/services/auth/sessionPermissionStormDetector';
import type { AuthUser } from '@/types/authRoleTypes';

vi.mock('@/services/observability/operationalTelemetryRecorder', () => ({
  recordOperationalTelemetry: vi.fn(),
}));

const user = { uid: 'u1', email: 'u1@hospital.test', role: 'nurse' } as unknown as AuthUser;

describe('useSessionPermissionGuard', () => {
  beforeEach(() => {
    resetSessionPermissionStormDetector();
  });

  it('ante una tormenta de permisos cierra sesión por la ruta automática y deja la razón visible', async () => {
    const handleLogout = vi.fn().mockResolvedValue(undefined);
    const setSessionState = vi.fn();
    renderHook(() => useSessionPermissionGuard(user, handleLogout, setSessionState));

    await act(async () => {
      reportBasicReadPermissionDenied('records:subscribeToRecord', 1_000);
      reportBasicReadPermissionDenied('catalog:nurse', 2_000);
      await Promise.resolve();
    });

    expect(handleLogout).toHaveBeenCalledWith('automatic');
    expect(setSessionState).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'unauthorized', reason: SESSION_PERMISSIONS_LOST_MESSAGE })
    );
  });

  it('sin usuario autenticado no escucha nada', async () => {
    const handleLogout = vi.fn().mockResolvedValue(undefined);
    const setSessionState = vi.fn();
    renderHook(() => useSessionPermissionGuard(null, handleLogout, setSessionState));

    await act(async () => {
      reportBasicReadPermissionDenied('records:subscribeToRecord', 1_000);
      reportBasicReadPermissionDenied('catalog:nurse', 2_000);
    });

    expect(handleLogout).not.toHaveBeenCalled();
    expect(setSessionState).not.toHaveBeenCalled();
  });

  it('al desmontar deja de escuchar', async () => {
    const handleLogout = vi.fn().mockResolvedValue(undefined);
    const setSessionState = vi.fn();
    const { unmount } = renderHook(() =>
      useSessionPermissionGuard(user, handleLogout, setSessionState)
    );
    unmount();

    await act(async () => {
      reportBasicReadPermissionDenied('records:subscribeToRecord', 1_000);
      reportBasicReadPermissionDenied('catalog:nurse', 2_000);
    });

    expect(handleLogout).not.toHaveBeenCalled();
  });
});
