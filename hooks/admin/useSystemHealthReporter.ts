import { useEffect, useRef } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useVersion } from '../../context/VersionContext';
import { useIsMutating } from '@tanstack/react-query';
import { getErrorLogs } from '../../services/storage/indexedDBService';
import { reportUserHealth, UserHealthStatus } from '../../services/admin/healthService';
import { CURRENT_SCHEMA_VERSION } from '../../constants/version';

const REPORT_INTERVAL_MS = 2 * 60 * 1000; // Report every 2 minutes

/**
 * Hook that periodically reports the system health status to Firestore.
 * Runs in the background and only reports if a user is logged in.
 */
export const useSystemHealthReporter = () => {
    const { user, isFirebaseConnected } = useAuth();
    const { isOutdated } = useVersion();
    const mutatingCount = useIsMutating();
    const lastReportTime = useRef<number>(0);

    useEffect(() => {
        if (!user) return;

        const reportHealth = async () => {
            try {
                // Get error count from IndexedDB
                const logs = await getErrorLogs(100);
                const localErrorCount = logs.length;

                const status: UserHealthStatus = {
                    uid: user.uid,
                    email: user.email || 'unknown',
                    displayName: user.displayName || 'Usuario',
                    lastSeen: new Date().toISOString(),
                    isOnline: isFirebaseConnected && navigator.onLine,
                    isOutdated: !!isOutdated,
                    pendingMutations: mutatingCount,
                    localErrorCount,
                    appVersion: `v${CURRENT_SCHEMA_VERSION}`,
                    platform: navigator.platform,
                    userAgent: navigator.userAgent
                };

                await reportUserHealth(status);
                lastReportTime.current = Date.now();
                // console.log('[HealthReporter] Status reported successfully');
            } catch (error) {
                console.error('[HealthReporter] Failed to report status:', error);
            }
        };

        // Immediate report on mount or when critical stats change
        reportHealth();

        // Setup interval for periodic reporting
        const interval = setInterval(() => {
            // Only report if enough time has passed (throttle)
            if (Date.now() - lastReportTime.current >= REPORT_INTERVAL_MS - 5000) {
                reportHealth();
            }
        }, REPORT_INTERVAL_MS);

        return () => clearInterval(interval);
    }, [user, isFirebaseConnected, isOutdated, mutatingCount]);
};
