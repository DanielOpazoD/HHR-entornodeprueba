import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import * as authSession from '@/services/auth/authSession';
import type { AuthContextType } from '@/context/AuthContext';
import type { AuthSessionState } from '@/types/authSessionTypes';
import type { AuthUser } from '@/types/authRoleTypes';

// The real session state, inactivity monitor and app gate; only Firebase and storage stay mocked.
vi.unmock('@/hooks/useAuthState');
vi.unmock('@/context/AuthContext');
vi.unmock('../../context/AuthContext');

vi.mock('@/services/session/sessionScopedStorageService', () => ({
  clearSessionScopedClientState: vi.fn(async (_reason: string, close?: () => Promise<void>) => {
    await close?.();
  }),
  reconcileAuthorizedSessionOwner: vi.fn().mockResolvedValue(undefined),
  resolveSessionOwnerKey: (uid: string | null | undefined) => (uid ? `user:${uid}` : null),
}));

// The census shell is out of scope; its navbar shows the account through the same UserMenu.
vi.mock('@/app-shell/runtime/AuthenticatedAppShell', async () => {
  const { UserMenu } = await import('@/components/layout/UserMenu');
  return {
    AuthenticatedAppShell: ({ auth }: { auth: AuthContextType }) => (
      <UserMenu
        userEmail={auth.currentUser?.email ?? ''}
        displayName={auth.currentUser?.displayName}
        isIndividualAccount={auth.currentUser?.uid.startsWith('hhrn_')}
        role={auth.role}
        onLogout={auth.signOut}
      />
    ),
  };
});

import App from '@/App';

// The owner's decision, not the constant: changing SESSION_TIMEOUT_MS must turn this red.
const ONE_HOUR_MS = 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;

const nurse: AuthUser = {
  uid: 'hhrn_sintetica',
  email: 'enfermeria.sintetica@hospital.test',
  displayName: 'Enfermera Sintética',
  role: 'nurse_hospital',
};

describe('one hour without use on a shared computer', () => {
  let emitSession: (state: AuthSessionState) => void | Promise<void> = () => {};

  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    sessionStorage.clear();
    vi.mocked(authSession.onAuthSessionStateChange).mockImplementation(callback => {
      emitSession = callback;
      void callback({ status: 'unauthenticated', user: null });
      return () => {};
    });
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    localStorage.clear();
  });

  it('keeps the account visible while in use and returns to the login screen after one idle hour', async () => {
    render(<App openingDay="2026-11-19" />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    await act(async () => {
      await emitSession({ status: 'authorized', user: nurse });
    });
    const accountName = () => screen.queryByTestId('active-account-name');
    const idleFor = async (ms: number) => {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(ms);
      });
    };

    expect(accountName()).toHaveTextContent('Enfermera Sintética');
    await idleFor(30 * MINUTE_MS);
    fireEvent.keyDown(window, { key: 'a' });
    await idleFor(ONE_HOUR_MS - MINUTE_MS);
    expect(accountName()).toHaveTextContent('Enfermera Sintética');

    await idleFor(MINUTE_MS + 2000);

    expect(accountName()).not.toBeInTheDocument();
    expect(screen.getByTestId('login-google-button')).toBeVisible();
    expect(authSession.signOut).toHaveBeenCalled();
  });
});
