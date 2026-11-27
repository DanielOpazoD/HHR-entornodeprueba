/**
 * AuthProvider
 * Wraps the application and provides authentication state backed by `useAuthState`.
 *
 * Kept separate from `AuthContext.tsx` so pre-login bootstrap chrome can read
 * `AuthContext` / `useAuth` without pulling `useAuthState` into `app-bootstrap`.
 */

import React, { ReactNode, useMemo } from 'react';
import { useAuthState } from '@/hooks/useAuthState';
import { useAuthClaimRefreshScheduler } from '@/hooks/useAuthClaimRefreshScheduler';
import {
  buildAuthContextValue,
  buildNormalizedAuthOperationalStateInput,
  type AuthContextType,
} from '@/context/authContextController';
import { resolveNormalizedAuthOperationalState } from '@/services/auth/authOperationalState';
import { AuthContext } from './AuthContext';

interface AuthProviderProps {
  children: ReactNode;
}

export const AuthProvider: React.FC<AuthProviderProps> = ({ children }) => {
  const authState = useAuthState();
  const {
    sessionState,
    currentUser,
    authorizedUser,
    authLoading,
    isFirebaseConnected,
    remoteSyncStatus,
    remoteSyncState,
    authRuntime,
    role,
    handleLogout,
  } = authState;

  const normalizedAuthState = useMemo(
    () =>
      resolveNormalizedAuthOperationalState(
        buildNormalizedAuthOperationalStateInput({
          sessionState,
          currentUser,
          authorizedUser,
          authLoading,
          isFirebaseConnected,
          remoteSyncStatus,
          remoteSyncState,
          authRuntime,
          role,
          handleLogout,
        })
      ),
    [
      sessionState,
      currentUser,
      authorizedUser,
      authLoading,
      isFirebaseConnected,
      remoteSyncStatus,
      remoteSyncState,
      authRuntime,
      role,
      handleLogout,
    ]
  );

  const value = useMemo<AuthContextType>(
    () => buildAuthContextValue(normalizedAuthState, authState.logoutPrompt),
    [normalizedAuthState, authState.logoutPrompt]
  );

  useAuthClaimRefreshScheduler({
    enabled: value.isAuthenticated,
    role: value.currentUser?.role ?? null,
  });

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};
