/**
 * AuthContext
 * Manages authentication state and user roles across the application.
 * Uses useAuthState hook internally as the single source of truth.
 * 
 * Supports both Firebase auth and offline passport authentication.
 * Roles: 'viewer' (read-only) | 'editor' (full access) | 'admin' (full access + admin features)
 */

import React, { createContext, useContext, ReactNode } from 'react';
import { AuthUser, UserRole } from '@/types';
export type { AuthUser, UserRole };
import { useAuthState } from '@/hooks/useAuthState';

// ============================================================================
// Types
// ============================================================================

export interface AuthContextType {
    user: AuthUser | null;
    role: UserRole;
    isLoading: boolean;
    isAuthenticated: boolean;
    isEditor: boolean;
    isViewer: boolean;
    isOfflineMode: boolean;
    isFirebaseConnected: boolean;
    signOut: () => Promise<void>;
    // Passport utilities
    canDownloadPassport: boolean;
    handleDownloadPassport: (role: UserRole) => Promise<boolean>;
}

// ============================================================================
// Context
// ============================================================================

const AuthContext = createContext<AuthContextType | undefined>(undefined);

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

    const value: AuthContextType = {
        user: authState.user,
        role: authState.role,
        isLoading: authState.authLoading,
        isAuthenticated: authState.user !== null,
        isEditor: authState.isEditor,
        isViewer: authState.isViewer,
        isOfflineMode: authState.isOfflineMode,
        isFirebaseConnected: authState.isFirebaseConnected,
        signOut: authState.handleLogout,
        canDownloadPassport: authState.canDownloadPassport,
        handleDownloadPassport: authState.handleDownloadPassport,
    };

    return (
        <AuthContext.Provider value={value}>
            {children}
        </AuthContext.Provider>
    );
};

// ============================================================================
// Hooks
// ============================================================================

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

