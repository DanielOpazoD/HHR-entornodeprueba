import { beginPendingLogout } from '@/services/auth/authLogoutState';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { User } from 'firebase/auth';
import type { AuthSessionState } from '@/types/authSessionTypes';

vi.unmock('@/services/auth/authSession');
const runtime = vi.hoisted(() => ({
  currentUser: null as User | null,
  observer: null as ((user: User | null) => Promise<void>) | null,
  call: vi.fn(),
  signOut: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('firebase/auth', () => ({
  GoogleAuthProvider: class {
    setCustomParameters() {}
  },
  onAuthStateChanged: (_auth: unknown, callback: typeof runtime.observer) => {
    runtime.observer = callback;
    return () => {};
  },
  signOut: runtime.signOut,
}));
vi.mock('firebase/functions', () => ({ httpsCallable: () => runtime.call }));
vi.mock('@/services/firebase-runtime/authRuntime', () => ({
  defaultAuthRuntime: {
    ready: Promise.resolve(),
    auth: {},
    getCurrentUser: () => runtime.currentUser,
  },
}));
vi.mock('@/services/firebase-runtime/functionsRuntime', () => ({
  defaultFunctionsRuntime: { getFunctions: async () => ({}) },
}));
vi.mock('@/services/auth/authRoleCache', () => ({
  clearRoleCacheForEmail: vi.fn().mockResolvedValue(undefined),
  saveRoleToCache: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/services/auth/authClaimSyncService', () => ({
  ensureUserRoleClaim: vi.fn().mockResolvedValue(undefined),
  resetAuthClaimSyncSnapshot: vi.fn(),
  resolveUserRoleClaim: vi.fn().mockResolvedValue('admin'),
}));
import {
  onAuthSessionStateChange,
  resolveCurrentAuthSessionState,
  signOut,
} from '@/services/auth/authSession';
import {
  CONFIRMED_AUTH_ROLE_KEY,
  clearRecentAuthRoleLookups,
  getConfirmedAuthRole,
  rememberConfirmedAuthRole,
} from '@/services/auth/authRoleLookup';

const user = (uid = 'synthetic-a', email = 'synthetic-a@hospital.invalid') =>
  ({
    uid,
    email,
    isAnonymous: false,
    displayName: 'Synthetic',
    photoURL: null,
    getIdTokenResult: vi
      .fn()
      .mockResolvedValue({ claims: { auth_time: Math.floor(Date.now() / 1000) } }),
  }) as unknown as User;
let stop = () => {};
const observe = async () => {
  const states: AuthSessionState[] = [];
  stop = onAuthSessionStateChange(state => {
    states.push(state);
  });
  await Promise.resolve();
  return states;
};

describe('restored account-bound server confirmation', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-02T15:00:00Z'));
    vi.clearAllMocks();
    sessionStorage.clear();
    clearRecentAuthRoleLookups();
    runtime.currentUser = user();
    runtime.call.mockResolvedValue({ data: { role: 'nurse_hospital' } });
  });
  afterEach(() => {
    stop();
    clearRecentAuthRoleLookups();
    vi.useRealTimers();
  });

  it('returns F5 admission before the server answers, then applies a changed role', async () => {
    const current = runtime.currentUser!;
    await rememberConfirmedAuthRole(current, 'admin', () => true);
    let answer!: (value: { data: { role: string } }) => void;
    runtime.call.mockReturnValue(
      new Promise(resolve => {
        answer = resolve;
      })
    );
    expect(await resolveCurrentAuthSessionState()).toMatchObject({
      status: 'authorized',
      user: { role: 'admin' },
    });
    const states = await observe();
    const pending = runtime.observer!(current);
    await vi.advanceTimersByTimeAsync(0);
    expect(states).toMatchObject([{ status: 'authorized', user: { role: 'admin' } }]);
    expect(runtime.call).toHaveBeenCalledOnce();
    answer({ data: { role: 'nurse_hospital' } });
    await pending;
    expect(states.at(-1)).toMatchObject({ status: 'authorized', user: { role: 'nurse_hospital' } });
    expect(getConfirmedAuthRole(current)).toBe('nurse_hospital');
  });

  it('keeps the screen unchanged on an identical server confirmation', async () => {
    const current = runtime.currentUser!;
    await rememberConfirmedAuthRole(current, 'nurse_hospital', () => true);
    const states = await observe();
    await runtime.observer!(current);
    expect(states).toHaveLength(1);
    expect(states[0]).toMatchObject({ status: 'authorized', user: { role: 'nurse_hospital' } });
  });

  it.each([null, 'unauthorized', 'functions/permission-denied', 'functions/unauthenticated'])(
    'closes a remembered session on authoritative %s',
    async denial => {
      const current = runtime.currentUser!;
      await rememberConfirmedAuthRole(current, 'admin', () => true);
      if (denial?.startsWith('functions/')) runtime.call.mockRejectedValue({ code: denial });
      else runtime.call.mockResolvedValue({ data: { role: denial } });
      const states = await observe();
      await runtime.observer!(current);
      expect(states.at(-1)?.status).toBe('unauthorized');
      expect(runtime.signOut).toHaveBeenCalledOnce();
      expect(getConfirmedAuthRole(current)).toBeNull();
    }
  );

  it('retains the remembered state through retries without renewing it or accepting an old claim', async () => {
    const current = runtime.currentUser!;
    await rememberConfirmedAuthRole(current, 'viewer', () => true);
    const before = sessionStorage.getItem(CONFIRMED_AUTH_ROLE_KEY);
    runtime.call.mockRejectedValue({ code: 'functions/unavailable' });
    const states = await observe();
    const pending = runtime.observer!(current);
    await vi.advanceTimersByTimeAsync(4000);
    await pending;
    expect(runtime.call).toHaveBeenCalledTimes(3);
    expect(states).toMatchObject([{ status: 'authorized', user: { role: 'viewer' } }]);
    expect(sessionStorage.getItem(CONFIRMED_AUTH_ROLE_KEY)).toBe(before);
    expect(runtime.signOut).not.toHaveBeenCalled();
  });

  it.each(['missing', 'expired', 'uid', 'email'])(
    'waits for the server when the remembered role is %s',
    async mode => {
      const current = runtime.currentUser!;
      if (mode !== 'missing') await rememberConfirmedAuthRole(current, 'admin', () => true);
      if (mode === 'expired') await vi.advanceTimersByTimeAsync(12 * 60 * 60 * 1000);
      if (mode === 'uid') runtime.currentUser = user('synthetic-b');
      if (mode === 'email') runtime.currentUser = user(current.uid, 'synthetic-b@hospital.invalid');
      let answer!: (value: { data: { role: string } }) => void;
      runtime.call.mockReturnValue(
        new Promise(resolve => {
          answer = resolve;
        })
      );
      let settled = false;
      const pending = resolveCurrentAuthSessionState().then(state => {
        settled = true;
        return state;
      });
      await vi.advanceTimersByTimeAsync(0);
      expect(settled).toBe(false);
      answer({ data: { role: 'viewer' } });
      expect(await pending).toMatchObject({ status: 'authorized', user: { role: 'viewer' } });
    }
  );

  it('removes the confirmation synchronously on explicit sign-out', async () => {
    const current = runtime.currentUser!;
    await rememberConfirmedAuthRole(current, 'admin', () => true);
    const pending = signOut();
    expect(getConfirmedAuthRole(current)).toBeNull();
    await pending;
  });

  it('caps repeated confirmations at the original Firebase session expiry', async () => {
    const current = runtime.currentUser!;
    await vi.advanceTimersByTimeAsync(11 * 60 * 60 * 1000);
    await rememberConfirmedAuthRole(current, 'admin', () => true);
    expect(getConfirmedAuthRole(current)).toBe('admin');
    await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
    expect(getConfirmedAuthRole(current)).toBeNull();
  });

  it('does not renew or readmit a session once logout audit has started', async () => {
    const current = runtime.currentUser!;
    await rememberConfirmedAuthRole(current, 'viewer', () => true);
    let answer!: (value: { data: { role: string } }) => void;
    runtime.call.mockReturnValueOnce(
      new Promise(resolve => {
        answer = resolve;
      })
    );
    const states = await observe();
    const pending = runtime.observer!(current);
    await vi.advanceTimersByTimeAsync(0);
    const finish = beginPendingLogout();
    const before = sessionStorage.getItem(CONFIRMED_AUTH_ROLE_KEY);
    answer({ data: { role: 'admin' } });
    await pending;
    finish();
    expect(states).toHaveLength(1);
    expect(sessionStorage.getItem(CONFIRMED_AUTH_ROLE_KEY)).toBe(before);
  });

  it('does not persist a stale server result after the actor changes', async () => {
    const old = runtime.currentUser!;
    await rememberConfirmedAuthRole(old, 'viewer', () => true);
    let answer!: (value: { data: { role: string } }) => void;
    runtime.call.mockReturnValueOnce(
      new Promise(resolve => {
        answer = resolve;
      })
    );
    const states = await observe();
    const pending = runtime.observer!(old);
    await vi.advanceTimersByTimeAsync(0);
    runtime.currentUser = user('synthetic-b', 'synthetic-b@hospital.invalid');
    await runtime.observer!(runtime.currentUser);
    answer({ data: { role: 'admin' } });
    await pending;
    expect(states.at(-1)).toMatchObject({ user: { uid: 'synthetic-b', role: 'nurse_hospital' } });
    expect(getConfirmedAuthRole(runtime.currentUser)).toBe('nurse_hospital');
    expect(getConfirmedAuthRole(old)).toBeNull();
  });
});
