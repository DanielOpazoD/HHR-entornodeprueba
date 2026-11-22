import { act, renderHook } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { useSessionPermissionGuard } from '@/hooks/useSessionPermissionGuard';
import { reportBasicReadPermissionDenied } from '@/services/auth/sessionPermissionStormDetector';
import { setSessionGeneration } from '@/services/session/sessionStorageTransition';
import { recordOperationalTelemetry } from '@/services/observability/operationalTelemetryRecorder';
import type { AuthUser } from '@/types/authRoleTypes';

// The deferred verdict module fails to load only after another session took over.
const gate = vi.hoisted(() => {
  let reject!: (error: Error) => void;
  const wait = new Promise<void>((_, fail) => {
    reject = fail;
  });
  return { wait, reject };
});
vi.mock('@/services/auth/sessionPermissionStormVerdict', async () => {
  await gate.wait;
  return {};
});
vi.mock('@/services/observability/operationalTelemetryRecorder', () => ({
  recordOperationalTelemetry: vi.fn(),
}));

it('a late failure to load the verdict never logs out, marks or reports the next session', async () => {
  setSessionGeneration('first', 'user:u1');
  const logout = vi.fn(async () => undefined);
  const setState = vi.fn();
  renderHook(() => useSessionPermissionGuard({ uid: 'u1' } as AuthUser, logout, setState));
  await act(async () => {
    reportBasicReadPermissionDenied('records:a', { now: 1000 });
    reportBasicReadPermissionDenied('catalog:b', { now: 2000 });
  });
  setSessionGeneration('second', 'user:u1');
  await act(async () => {
    gate.reject(new Error('Failed to fetch dynamically imported module'));
    for (let i = 0; i < 10; i += 1) await new Promise(resolve => setTimeout(resolve, 0));
  });
  expect({
    logout: logout.mock.calls.length,
    state: setState.mock.calls.length,
    telemetry: vi.mocked(recordOperationalTelemetry).mock.calls.length,
  }).toEqual({ logout: 0, state: 0, telemetry: 0 });
});
