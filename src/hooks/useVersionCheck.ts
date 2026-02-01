/**
 * useVersionCheck Hook
 * 
 * Automatically detects app version changes after deployments.
 * When a new version is detected:
 * 1. Clears Service Worker cache
 * 2. Clears stale localStorage data
 * 3. Reloads the page
 * 
 * This prevents cache-related issues when users have outdated code.
 */

import { useEffect, useRef } from 'react';

const VERSION_KEY = 'hhr_app_version';
const VERSION_URL = '/version.json';

interface VersionInfo {
    version: string;
    buildDate: string;
}

/**
 * Clears all Service Worker caches.
 */
const clearServiceWorkerCaches = async (): Promise<void> => {
    if ('caches' in window) {
        try {
            const cacheNames = await caches.keys();
            await Promise.all(cacheNames.map(name => caches.delete(name)));
            // console.info('[VersionCheck] ✅ Cleared all SW caches');
        } catch (error) {
            console.warn('[VersionCheck] Failed to clear caches:', error);
        }
    }
};

/**
 * Tells the Service Worker to skip waiting and activate immediately.
 */
const refreshServiceWorker = async (): Promise<void> => {
    if ('serviceWorker' in navigator) {
        try {
            const registration = await navigator.serviceWorker.getRegistration();
            if (registration?.waiting) {
                registration.waiting.postMessage({ type: 'SKIP_WAITING' });
            }
            // Also request cache clear
            if (registration?.active) {
                registration.active.postMessage({ type: 'CLEAR_CACHE' });
            }
        } catch (error) {
            console.warn('[VersionCheck] SW refresh failed:', error);
        }
    }
};

/**
 * Clears localStorage except for critical keys that should persist.
 */
const clearStaleLocalStorage = (): void => {
    // Keys to preserve across version updates
    const keysToPreserve = [
        'hhr_offline_user',      // Passport user data
        'hhr_passport_token',    // Passport token
    ];

    const preserved: Record<string, string | null> = {};

    // Save values to preserve
    keysToPreserve.forEach(key => {
        preserved[key] = localStorage.getItem(key);
    });

    // Clear all
    localStorage.clear();

    // Restore preserved values
    keysToPreserve.forEach(key => {
        if (preserved[key] !== null) {
            localStorage.setItem(key, preserved[key]!);
        }
    });

    // console.info('[VersionCheck] ✅ Cleared stale localStorage');
};

/**
 * Hook that checks for app version changes on mount.
 * If a new version is detected, clears caches and reloads.
 */
export const useVersionCheck = (): void => {
    const hasChecked = useRef(false);

    useEffect(() => {
        // Only run once per session
        if (hasChecked.current) return;
        hasChecked.current = true;

        const checkVersion = async () => {
            try {
                // Fetch current version from server (bypass cache)
                const response = await fetch(`${VERSION_URL}?t=${Date.now()}`, {
                    cache: 'no-store',
                    headers: { 'Cache-Control': 'no-cache' }
                });

                if (!response.ok) {
                    // version.json might not exist in dev mode, that's ok
                    console.warn('[VersionCheck] version.json not found (dev mode?)');
                    return;
                }

                const serverVersion: VersionInfo = await response.json();
                const localVersion = localStorage.getItem(VERSION_KEY);

                // console.info(`[VersionCheck] Server: ${serverVersion.version}, Local: ${localVersion || 'none'}`);

                if (!localVersion) {
                    // First time user, just save version
                    localStorage.setItem(VERSION_KEY, serverVersion.version);
                    // console.info('[VersionCheck] ✅ First visit, version saved');
                    return;
                }

                if (localVersion !== serverVersion.version) {
                    // console.info('[VersionCheck] 🔄 New version detected! Refreshing...');

                    // Clear caches
                    await clearServiceWorkerCaches();
                    await refreshServiceWorker();
                    clearStaleLocalStorage();

                    // Save new version BEFORE reload
                    localStorage.setItem(VERSION_KEY, serverVersion.version);

                    // Give SW time to process, then reload
                    setTimeout(() => {
                        window.location.reload();
                    }, 500);
                } else {
                    // console.info('[VersionCheck] ✅ Version up to date');
                }
            } catch (error) {
                // Network error or parsing error - not critical
                console.warn('[VersionCheck] Check failed (offline?):', error);
            }
        };

        // Small delay to not block initial render
        setTimeout(checkVersion, 1000);
    }, []);
};
