/**
 * AuthContext
 * Lightweight context and hooks for reading authentication state and user roles.
 *
 * AuthProvider lives in `./AuthProvider` so pre-login consumers of `useAuth` /
 * `AuthContext` do not pull `useAuthState` or Firebase auth flows into `app-bootstrap`.
 */

import { createContext, useContext } from 'react';
import type { AuthUser, UserRole } from '@/types/authRoleTypes';
import { buildAuthContextValue, type AuthContextType } from '@/context/authContextController';

export { buildAuthContextValue };
export type { AuthContextType, AuthUser, UserRole };

export const AuthContext = createContext<AuthContextType | undefined>(undefined);

/**
 * Hook to access authentication context.
 * Must be used within an AuthProvider.
 */
export const useAuth = (): AuthContextType => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

/**
 * Convenience hook to check if user can edit.
 * @returns true if user has edit permissions
 */
export const useCanEdit = (): boolean => {
  const { isEditor } = useAuth();
  return isEditor;
};
