/**
 * AuthContext
 * Manages authentication state and user roles across the application.
 * Uses useAuthState hook internally as the single source of truth.
 *
 * Supports Firebase auth and signature-mode access.
 * Roles: 'viewer' (read-only) | 'editor' (full access) | 'admin' (full access + admin features)
 */

import React, { ReactNode, useMemo } from 'react';
import { useAuthState } from '@/hooks/useAuthState';
import { useAuthClaimRefreshScheduler } from '@/hooks/useAuthClaimRefreshScheduler';
import type { UserRole, AuthUser } from '@/types/authRoleTypes';
export type { AuthUser, UserRole };
import {
  buildAuthContextValue,
  buildNormalizedAuthOperationalStateInput,
  type AuthContextType,
} from '@/context/authContextController';
import { resolveNormalizedAuthOperationalState } from '@/services/auth/authOperationalState';
import { AuthContext, useAuth, useCanEdit } from './authContextCore';

export { AuthContext, buildAuthContextValue, useAuth, useCanEdit };
export type { AuthContextType };

// ============================================================================
// Provider
// ============================================================================

interface AuthProviderProps {
  children: ReactNode;
}

/**
 * AuthProvider wraps the application and provides authentication state.
 * Internally uses useAuthState hook - this ensures a single source of truth.
 */
export const AuthProvider: React.FC<AuthProviderProps> = ({ children }) => {
  // Use the hook as the single source of truth
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
