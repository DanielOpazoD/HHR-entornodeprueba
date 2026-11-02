import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { User } from 'firebase/auth';
import type { AuthSessionState } from '@/types/authSessionTypes';
vi.unmock('@/services/auth/authSession');
const runtime = vi.hoisted(() => ({
  auth: { currentUser: null as User | null, app: { options: { apiKey: 'synthetic-key' } } },
  observer: null as ((user: User | null) => Promise<void>) | null,
  pendingObserver: Promise.resolve(),
  response: {} as object,
  role: 'nurse_hospital' as string | null,
  roleCalls: 0,
  result: null as User | null,
  signOut: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('firebase/auth', () => ({
  GoogleAuthProvider: class {
    setCustomParameters() {}
  },
  browserSessionPersistence: 'session',
  setPersistence: vi.fn().mockResolvedValue(undefined),
  signInWithEmailAndPassword: async () => {
    runtime.auth.currentUser = runtime.result;
    runtime.pendingObserver = runtime.observer?.(runtime.result) ?? Promise.resolve();
    return { user: runtime.result };
  },
  onAuthStateChanged: (_auth: unknown, callback: typeof runtime.observer) => {
    runtime.observer = callback;
    return () => {};
  },
  signOut: runtime.signOut,
}));
vi.mock('firebase/functions', () => ({
  httpsCallable: (_functions: unknown, name: string) => async () => {
    if (name === 'checkUserRole') {
      runtime.roleCalls += 1;
      return { data: { role: runtime.role } };
    }
    return { data: runtime.response };
  },
}));
vi.mock('@/services/firebase-runtime/authRuntime', () => ({
  defaultAuthRuntime: {
    ready: Promise.resolve(),
    auth: runtime.auth,
    getCurrentUser: () => runtime.auth.currentUser,
  },
}));
vi.mock('@/services/firebase-runtime/functionsRuntime', () => ({
  defaultFunctionsRuntime: {
    getFunctions: async () => ({}),
    getRegionalFunctions: async () => ({}),
  },
}));
vi.mock('@/services/auth/authRoleCache', () => ({
  clearRoleCacheForEmail: vi.fn().mockResolvedValue(undefined),
  saveRoleToCache: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/services/auth/authClaimSyncService', () => ({
  ensureUserRoleClaim: vi.fn().mockResolvedValue(undefined),
  resetAuthClaimSyncSnapshot: vi.fn(),
  resolveUserRoleClaim: vi.fn().mockResolvedValue(null),
}));
import { establishNursingSession } from '@/services/auth/nursingAccountService';
import {
  clearConfirmedAuthRole,
  clearRecentAuthRoleLookups,
  getConfirmedAuthRole,
} from '@/services/auth/authRoleLookup';
import {
  onAuthSessionStateChange,
  resolveCurrentAuthSessionState,
} from '@/services/auth/authSession';

const uid = 'hhrn_synthetic-role';
const email = `${uid}@accounts.hhr.invalid`;
const user = (overrides = {}) =>
  ({
    uid,
    email,
    isAnonymous: false,
    displayName: 'Synthetic',
    photoURL: null,
    getIdTokenResult: async () => ({ claims: { auth_time: Math.floor(Date.now() / 1000) } }),
    ...overrides,
  }) as unknown as User;
let stop = () => {};
const login = async () => {
  const states: AuthSessionState[] = [];
  stop = onAuthSessionStateChange(state => {
    states.push(state);
  });
  await Promise.resolve();
  await establishNursingSession('signInWithRut', { password: 'Synthetic1', rut: '111111111' });
  await runtime.pendingObserver;
  return states;
};

describe('RUT callable role and resulting Firebase account', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    sessionStorage.clear();
    clearConfirmedAuthRole();
    clearRecentAuthRoleLookups();
    runtime.auth.currentUser = null;
    runtime.result = user();
    runtime.response = { uid, credentialEmail: email, role: 'admin' };
    runtime.roleCalls = 0;
    runtime.role = 'nurse_hospital';
  });
  afterEach(() => {
    stop();
    clearRecentAuthRoleLookups();
  });

  it('admits the server-confirmed role without checkUserRole even when the observer runs before SDK completion', async () => {
    const states = await login();
    expect(states.at(-1)).toMatchObject({ status: 'authorized', user: { uid, role: 'admin' } });
    expect(runtime.roleCalls).toBe(0);
    expect(getConfirmedAuthRole(runtime.result!)).toBe('admin');
  });

  it.each([
    { credentialEmail: email },
    { uid, credentialEmail: email, role: null },
    { uid, credentialEmail: email, role: 'invalid' },
    { credentialEmail: email, role: 'admin' },
  ])('uses the existing lookup with an older or incomplete server response %j', async response => {
    runtime.response = response;
    const states = await login();
    expect(runtime.roleCalls).toBe(1);
    expect(states.at(-1)).toMatchObject({ status: 'authorized', user: { role: 'nurse_hospital' } });
  });

  it.each([{ uid: 'hhrn_other' }, { email: 'hhrn_other@accounts.hhr.invalid' }])(
    'rejects the returned role for a different Firebase account: %j',
    async overrides => {
      runtime.result = user(overrides);
      const states = await login();
      expect(runtime.roleCalls).toBe(1);
      expect(states.at(-1)).toMatchObject({
        status: 'authorized',
        user: { role: 'nurse_hospital' },
      });
      expect(getConfirmedAuthRole(runtime.result!)).toBe('nurse_hospital');
    }
  );

  it('still confirms a subsequent F5 and closes a revoked account', async () => {
    await login();
    stop();
    clearRecentAuthRoleLookups(); // A reload recreates the in-memory lookup service.
    runtime.role = null;
    expect(await resolveCurrentAuthSessionState()).toMatchObject({
      status: 'authorized',
      user: { role: 'admin' },
    });
    const states: AuthSessionState[] = [];
    stop = onAuthSessionStateChange(state => {
      states.push(state);
    });
    await Promise.resolve();
    await runtime.observer!(runtime.result);
    expect(runtime.roleCalls).toBe(1);
    expect(states.at(-1)?.status).toBe('unauthorized');
    expect(runtime.signOut).toHaveBeenCalledOnce();
    expect(getConfirmedAuthRole(runtime.result!)).toBeNull();
  });
});
