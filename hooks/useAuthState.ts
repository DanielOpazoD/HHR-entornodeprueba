import { useState, useEffect, useCallback } from 'react';
import { onAuthChange, signOut, AuthUser, hasActiveFirebaseSession, signInAnonymouslyForPassport } from '../services/auth/authService';
import {
    getStoredPassport,
    validatePassport,
    clearStoredPassport,
    isEligibleForPassport,
    downloadPassport
} from '../services/auth/passportService';
import { logUserLogout, logUserLogin } from '../services/admin/auditService';
import { getSetting, saveSetting } from '../services/storage/indexedDBService';

/**
 * Available user roles in the application.
 * Controls access to different modules and features.
 * 
 * - `viewer`: Read-only access to all data
 * - `editor`: Can modify patient data and daily records
 * - `admin`: Full access including system configuration
 * - `nurse_hospital`: Hospital nurse with edit permissions (from passport)
 * - `doctor_urgency`: Emergency doctor with limited edit access
 * - `viewer_census`: Can only view census data
 */
export type UserRole = 'viewer' | 'editor' | 'admin' | 'nurse_hospital' | 'doctor_urgency' | 'viewer_census';

/**
 * Return type for the useAuthState hook.
 * Provides user authentication state, role information, and auth actions.
 */
export interface UseAuthStateReturn {
    /** Current authenticated user or null if not logged in */
    user: AuthUser | null;
    /** True while authentication state is being determined */
    authLoading: boolean;
    /** True if connected to Firebase (either real or anonymous auth) */
    isFirebaseConnected: boolean;
    /** Signs out the current user (clears Firebase and passport auth) */
    handleLogout: () => Promise<void>;

    // Role-based properties
    /** Current user's role */
    role: UserRole;
    /** True if user has edit permissions (editor, admin, or nurse_hospital) */
    isEditor: boolean;
    /** True if user only has view permissions */
    isViewer: boolean;
    /** Alias for isEditor - true if user can modify data */
    canEdit: boolean;

    // Offline passport properties
    /** True if using offline passport authentication (no Firebase) */
    isOfflineMode: boolean;
    /** True if current user can generate offline passports (admin only) */
    canDownloadPassport: boolean;
    /** Downloads a passport file for offline access with specified role */
    handleDownloadPassport: (role: string) => Promise<boolean>;
}

import { SESSION_TIMEOUT_MS, ACTIVITY_EVENTS } from '../constants/security';

/**
 * useAuthState Hook
 * 
 * Central hook for managing authentication state throughout the application.
 * Supports dual authentication modes:
 * 
 * 1. **Firebase Auth**: Standard email/password authentication with real-time sync
 * 2. **Offline Passport**: Encrypted token-based auth for offline/island access
 * 
 * The hook automatically detects stored passports on mount and validates them.
 * Firebase connection status is monitored to enable/disable sync features.
 * 
 * @returns Authentication state, user info, role flags, and auth actions
 */
export const useAuthState = (): UseAuthStateReturn => {
    const [user, setUser] = useState<AuthUser | null>(null);
    const [authLoading, setAuthLoading] = useState(true);
    const [isFirebaseConnected, setIsFirebaseConnected] = useState(false);
    const [isOfflineMode, setIsOfflineMode] = useState(false);
    const [isOnline, setIsOnline] = useState(window.navigator.onLine);

    // ========================================================================
    // Authentication Actions
    // ========================================================================

    /**
     * Performs a full sign-out, clearing both Firebase sessions and local passport tokens.
     * 
     * @param reason - Whether the logout was 'manual' (user clicked) or 'automatic' (session timeout).
     */
    const handleLogout = useCallback(async (reason: 'manual' | 'automatic' = 'manual') => {
        // Log the logout event before clearing data
        if (user?.email) {
            await logUserLogout(user.email, reason);
        }

        // Clear offline data
        await clearStoredPassport();
        await saveSetting('hhr_offline_user', null);
        localStorage.removeItem('hhr_offline_user'); // Cleanup

        // Reset login flag for audit tracking
        if (typeof sessionStorage !== 'undefined') {
            sessionStorage.removeItem('hhr_logged_this_session');
        }

        setIsOfflineMode(false);

        // Firebase sign out (may fail if offline, that's ok)
        try {
            await signOut();
        } catch (error) {
            console.warn('[useAuthState] Firebase signOut failed (probably offline):', error);
        }

        setUser(null);
    }, [user]);

    // ========================================================================
    // Inactivity Detection (MINSAL Requirement)
    // ========================================================================
    useEffect(() => {
        if (!user) return;

        let timeoutId: NodeJS.Timeout;

        const resetTimer = () => {
            if (timeoutId) clearTimeout(timeoutId);
            timeoutId = setTimeout(() => {
                console.warn('[useAuthState] Logout due to inactivity');
                handleLogout('automatic');
            }, SESSION_TIMEOUT_MS);
        };

        // Add activity listeners
        ACTIVITY_EVENTS.forEach(event => {
            window.addEventListener(event, resetTimer);
        });

        // Initial timer start
        resetTimer();

        return () => {
            if (timeoutId) clearTimeout(timeoutId);
            ACTIVITY_EVENTS.forEach(event => {
                window.removeEventListener(event, resetTimer);
            });
        };
    }, [user, handleLogout]);

    // Network status listeners
    useEffect(() => {
        const handleOnline = async () => {
            // console.debug('[useAuthState] Network is ONLINE');
            setIsOnline(true);
            const storedUser = await getSetting<AuthUser | null>('hhr_offline_user', null);
            if (storedUser) {
                signInAnonymouslyForPassport().catch((err: unknown) =>
                    console.warn('[useAuthState] Proactive re-auth failed:', err)
                );
            }
        };

        const handleOffline = () => {
            // console.debug('[useAuthState] Network is OFFLINE');
            setIsOnline(false);
        };

        window.addEventListener('online', handleOnline);
        window.addEventListener('offline', handleOffline);

        return () => {
            window.removeEventListener('online', handleOnline);
            window.removeEventListener('offline', handleOffline);
        };
    }, []);

    // Check for offline passport user on mount
    useEffect(() => {
        // console.debug('[useAuthState] 🚀 Initializing Auth System...');

        const checkOfflineUser = async () => {
            // console.debug('[useAuthState] 🔍 Checking local storage for offline user...');
            try {
                let offlineUser = await getSetting<AuthUser | null>('hhr_offline_user', null);

                // Fallback for migration
                if (!offlineUser) {
                    const legacy = localStorage.getItem('hhr_offline_user');
                    if (legacy) {
                        offlineUser = JSON.parse(legacy);
                        await saveSetting('hhr_offline_user', offlineUser);
                    }
                }

                if (offlineUser) {
                    const passport = await getStoredPassport();
                    if (passport) {
                        const result = await validatePassport(passport);
                        if (result.valid) {
                            // console.debug('[useAuthState] ✅ Valid offline passport found');
                            setUser(offlineUser);
                            setIsOfflineMode(true);
                            setAuthLoading(false);
                            return true;
                        } else {
                            console.warn('[useAuthState] ❌ Stored passport is invalid:', result.error);
                            await clearStoredPassport();
                            await saveSetting('hhr_offline_user', null);
                            localStorage.removeItem('hhr_offline_user');
                        }
                    }
                }
            } catch (error) {
                console.error('[useAuthState] ‼️ Error checking offline user:', error);
            }
            return false;
        };

        const initAuth = async () => {
            // console.debug('[useAuthState] 📡 Subscribing to Firebase Auth changes...');

            // Subscribe to Firebase Auth first (higher priority)
            const unsubscribe = onAuthChange(async (authUser) => {
                // console.debug('[useAuthState] 🔔 Auth State Change received:', authUser ? authUser.email : 'NULL');

                if (authUser) {
                    const isAnonymousUser = authUser.email === null;
                    const email = authUser.email;

                    if (!isAnonymousUser && email) {
                        if (typeof sessionStorage !== 'undefined' && !sessionStorage.getItem('hhr_logged_this_session')) {
                            logUserLogin(email);
                            sessionStorage.setItem('hhr_logged_this_session', 'true');
                        }
                    }

                    if (isAnonymousUser) {
                        const passportUser = await getSetting<AuthUser | null>('hhr_offline_user', null);
                        if (passportUser) {
                            setUser(passportUser);
                            setIsOfflineMode(false);
                        } else {
                            setUser(authUser);
                            setIsOfflineMode(false);
                        }
                    } else {
                        // console.debug('[useAuthState] 👤 Real Google user detected. Overriding any local passport.');
                        setUser(authUser);
                        setIsOfflineMode(false);
                        await saveSetting('hhr_offline_user', null);
                        localStorage.removeItem('hhr_offline_user');
                        await clearStoredPassport();
                    }
                } else {
                    // console.debug('[useAuthState] 👤 Firebase user is NULL, checking offline fallback...');
                    // Only check offline if Firebase reports no user
                    const hasOffline = await checkOfflineUser();
                    if (!hasOffline) {
                        setUser(null);
                    }
                }

                // console.debug('[useAuthState] ✨ Auth transition finished');
                setAuthLoading(false);
            });

            return unsubscribe;
        };

        let unsubscribe: (() => void) | undefined;

        // Safety timeout: If Firebase takes too long (e.g. network issues), stop loading
        // Shorter timeout if we're already offline to show LoginPage faster
        const timeoutMs = window.navigator.onLine ? 8000 : 3000;
        const safetyTimeout = setTimeout(() => {
            console.warn(`[useAuthState] ⚠️ Auth initialization timed out (${timeoutMs}ms) - forcing load completion`);
            setAuthLoading(false);
        }, timeoutMs);

        initAuth().then(unsub => {
            if (unsub) unsubscribe = unsub;
        });

        return () => {
            // console.debug('[useAuthState] 🧹 Cleaning up Auth subscription');
            clearTimeout(safetyTimeout);
            if (unsubscribe) unsubscribe();
        };
    }, []);

    useEffect(() => {
        const checkConnection = () => {
            const hasSession = hasActiveFirebaseSession();
            setIsFirebaseConnected(isOnline && (hasSession || (!!user && !isOfflineMode)));
        };

        checkConnection();
        const interval = setInterval(checkConnection, 1000);
        const timeout = setTimeout(() => clearInterval(interval), 10000);

        return () => {
            clearInterval(interval);
            clearTimeout(timeout);
        };
    }, [user, isOfflineMode, isOnline]);

    /**
     * Generates and downloads a passport file for the current user.
     * Only admin can generate passports.
     * 
     * @param role - The role to assign: 'admin' or 'nurse_hospital'
     * @returns True if the download was successful, false otherwise.
     */
    const handleDownloadPassport = useCallback(async (role: string) => {
        if (!user) return false;
        return await downloadPassport(user, role);
    }, [user]);

    const role: UserRole = (user?.role as UserRole) || 'viewer';
    const isEditor = role === 'editor' || role === 'admin' || role === 'nurse_hospital';
    const isViewer = !isEditor;
    const canEdit = isEditor;
    const canDownloadPassport = isEligibleForPassport(user);

    return {
        user,
        authLoading,
        isFirebaseConnected,
        handleLogout,
        role,
        isEditor,
        isViewer,
        canEdit,
        isOfflineMode,
        canDownloadPassport,
        handleDownloadPassport,
    };
};
