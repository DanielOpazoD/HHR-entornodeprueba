// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const firestore = vi.hoisted(() => ({
  read: vi.fn<() => Promise<unknown>>(),
}));

vi.mock('firebase/firestore', () => ({
  doc: (...segments: unknown[]) => ({ path: segments.slice(1).join('/') }),
  getDocFromServer: () => firestore.read(),
}));

import {
  hasRecentRecoveryReload,
  markRecoveryReload,
  probeSessionReadPermission,
  SESSION_PERMISSION_RECOVERY_COOLDOWN_MS,
} from '@/services/auth/sessionPermissionProbe';

const firestoreRuntime = { getDb: () => ({}) as never };
const signedIn = (getIdToken = vi.fn().mockResolvedValue('token')) => ({
  getCurrentUser: () => ({ getIdToken }) as never,
});

describe('probeSessionReadPermission', () => {
  beforeEach(() => {
    firestore.read.mockReset();
    sessionStorage.clear();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('refresca el token y lee del servidor: legible si ambos funcionan', async () => {
    const getIdToken = vi.fn().mockResolvedValue('token');
    firestore.read.mockResolvedValue({ exists: () => true });

    await expect(
      probeSessionReadPermission({ authRuntime: signedIn(getIdToken), firestoreRuntime })
    ).resolves.toBe('readable');
    expect(getIdToken).toHaveBeenCalledWith(true);
    expect(firestore.read).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['permission-denied', 'denied'],
    ['unauthenticated', 'denied'],
    ['unavailable', 'failed'],
  ])('una lectura que falla con %s da %s', async (code, outcome) => {
    firestore.read.mockRejectedValue({ code });

    await expect(
      probeSessionReadPermission({ authRuntime: signedIn(), firestoreRuntime })
    ).resolves.toBe(outcome);
  });

  it('un token que no se puede renovar no da por buena la sesión', async () => {
    const getIdToken = vi.fn().mockRejectedValue({ code: 'auth/user-token-expired' });

    await expect(
      probeSessionReadPermission({ authRuntime: signedIn(getIdToken), firestoreRuntime })
    ).resolves.toBe('failed');
    expect(firestore.read).not.toHaveBeenCalled();
  });

  it('sin usuario no hay sesión que salvar', async () => {
    await expect(
      probeSessionReadPermission({ authRuntime: { getCurrentUser: () => null }, firestoreRuntime })
    ).resolves.toBe('denied');
  });

  it('una lectura que no responde termina en timeout', async () => {
    vi.useFakeTimers();
    firestore.read.mockReturnValue(new Promise(() => {}));

    const outcome = probeSessionReadPermission({
      authRuntime: signedIn(),
      firestoreRuntime,
      timeoutMs: 5_000,
    });
    await vi.advanceTimersByTimeAsync(5_000);

    await expect(outcome).resolves.toBe('timeout');
  });
});

describe('recarga de recuperación', () => {
  beforeEach(() => sessionStorage.clear());

  it('recuerda la recarga solo durante el período de espera', () => {
    expect(hasRecentRecoveryReload(1_000)).toBe(false);
    expect(markRecoveryReload(1_000)).toBe(true);
    expect(hasRecentRecoveryReload(1_000 + SESSION_PERMISSION_RECOVERY_COOLDOWN_MS - 1)).toBe(true);
    expect(hasRecentRecoveryReload(1_000 + SESSION_PERMISSION_RECOVERY_COOLDOWN_MS)).toBe(false);
  });

  it('si el almacenamiento falla no marca nada y no se declara reciente', () => {
    vi.stubGlobal('sessionStorage', {
      getItem: () => null,
      setItem: () => {
        throw new Error('blocked');
      },
    });
    expect(markRecoveryReload(1_000)).toBe(false);
    expect(hasRecentRecoveryReload(1_000)).toBe(false);
    vi.unstubAllGlobals();
  });
});
