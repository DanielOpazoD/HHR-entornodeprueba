// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockIsAuthBootstrapPending = vi.fn();
const mockGetAuthBootstrapPendingAgeMs = vi.fn();
const mockHasRecentManualLogout = vi.fn();
const mockGetAuthClaimSyncSnapshot = vi.fn();

vi.mock('@/services/auth/authBootstrapState', () => ({
  isAuthBootstrapPending: () => mockIsAuthBootstrapPending(),
  getAuthBootstrapPendingAgeMs: () => mockGetAuthBootstrapPendingAgeMs(),
}));

vi.mock('@/services/auth/authLogoutState', () => ({
  hasRecentManualLogout: () => mockHasRecentManualLogout(),
}));

vi.mock('@/services/auth/authClaimSyncService', () => ({
  getAuthClaimSyncSnapshot: () => mockGetAuthClaimSyncSnapshot(),
}));

import { buildAuthRuntimeSnapshot } from '@/services/auth/authRuntimeSnapshot';

describe('authRuntimeSnapshot', () => {
  const FIXED_ATTEMPT_AT = 1_777_000_000_000;

  beforeEach(() => {
    vi.clearAllMocks();
    mockIsAuthBootstrapPending.mockReturnValue(false);
    mockGetAuthBootstrapPendingAgeMs.mockReturnValue(0);
    mockHasRecentManualLogout.mockReturnValue(false);
    mockGetAuthClaimSyncSnapshot.mockReturnValue({
      status: 'idle',
      lastAttemptAt: null,
      lastResolvedRole: null,
    });
  });

  it('classifies pending bootstrap as recoverable with redirect budget profile', () => {
    mockIsAuthBootstrapPending.mockReturnValue(true);
    mockGetAuthBootstrapPendingAgeMs.mockReturnValue(12_000);

    const snapshot = buildAuthRuntimeSnapshot({
      sessionState: { status: 'authenticating', user: null },
      authLoading: true,
      isFirebaseConnected: false,
      isOnline: true,
    });

    expect(snapshot.runtimeState).toBe('recoverable');
    expect(snapshot.bootstrapPending).toBe(true);
    expect(snapshot.budgetProfile).toBe('redirect_pending');
    expect(snapshot.issues).toContain(
      'El bootstrap de autenticacion sigue pendiente y puede requerir recuperacion.'
    );
  });

  it('classifies unauthorized sessions with unauthorized runtime state', () => {
    const snapshot = buildAuthRuntimeSnapshot({
      sessionState: { status: 'unauthorized', user: null, reason: 'role_not_resolved' },
      authLoading: false,
      isFirebaseConnected: false,
      isOnline: true,
    });

    expect(snapshot.runtimeState).toBe('unauthorized');
    expect(snapshot.sessionStatus).toBe('unauthorized');
    expect(snapshot.issues).toContain(
      'La sesion actual no tiene autorizacion valida para el acceso solicitado.'
    );
  });

  it('classifies retryable auth errors without collapsing them into blocked', () => {
    const snapshot = buildAuthRuntimeSnapshot({
      sessionState: {
        status: 'auth_error',
        user: null,
        error: {
          message: 'Temporary failure',
          retryable: true,
        },
      },
      authLoading: false,
      isFirebaseConnected: false,
      isOnline: true,
    });

    expect(snapshot.runtimeState).toBe('retryable');
    expect(snapshot.issues).toContain('Temporary failure');
  });

  it('classifies non-retryable auth errors as blocked', () => {
    const snapshot = buildAuthRuntimeSnapshot({
      sessionState: {
        status: 'auth_error',
        user: null,
        error: {
          message: 'Blocked failure',
          retryable: false,
        },
      },
      authLoading: false,
      isFirebaseConnected: true,
      isOnline: true,
    });

    expect(snapshot.runtimeState).toBe('blocked');
    expect(snapshot.issues).toContain('Blocked failure');
  });

  it('classifies loading without pending bootstrap as degraded', () => {
    const snapshot = buildAuthRuntimeSnapshot({
      sessionState: { status: 'authenticating', user: null },
      authLoading: true,
      isFirebaseConnected: true,
      isOnline: true,
    });

    expect(snapshot.bootstrapPending).toBe(false);
    expect(snapshot.runtimeState).toBe('degraded');
  });

  it('marks authorized offline sessions without Firebase as degraded and reports connectivity issue', () => {
    const snapshot = buildAuthRuntimeSnapshot({
      sessionState: { status: 'authorized', user: { uid: 'user-1' } as never },
      authLoading: false,
      isFirebaseConnected: false,
      isOnline: false,
    });

    expect(snapshot.runtimeState).toBe('degraded');
    expect(snapshot.issues).toContain(
      'Firebase no esta conectado mientras el cliente permanece sin red.'
    );
  });

  it('surfaces failed claim sync as a degraded authorized runtime', () => {
    mockGetAuthClaimSyncSnapshot.mockReturnValue({
      status: 'failed',
      lastAttemptAt: FIXED_ATTEMPT_AT,
      lastResolvedRole: 'admin',
      lastErrorMessage: 'claim sync failed',
    });

    const snapshot = buildAuthRuntimeSnapshot({
      sessionState: {
        status: 'authorized',
        user: { uid: 'user-1', role: 'admin' } as never,
      },
      authLoading: false,
      isFirebaseConnected: true,
      isOnline: true,
    });

    expect(snapshot.runtimeState).toBe('degraded');
    expect(snapshot.claimSyncStatus).toBe('failed');
    expect(snapshot.issues).toContain('El claim de rol no se pudo sincronizar: claim sync failed');
  });
});
