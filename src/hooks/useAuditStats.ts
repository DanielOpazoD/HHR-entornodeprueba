/**
 * useAuditStats Hook
 * Calculates statistics and metrics from audit logs.
 */

import { useMemo } from 'react';
import { AuditLogEntry, AuditAction, AuditStats } from '@/types/audit';
import { CRITICAL_ACTIONS, IMPORTANT_ACTIONS } from '@/services/admin/auditConstants';

export const useAuditStats = (logs: AuditLogEntry[]): AuditStats => {
    return useMemo(() => {
        const now = new Date();
        const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const weekStart = new Date(todayStart);
        weekStart.setDate(weekStart.getDate() - 7);

        // Filter logs by time
        const todayLogs = logs.filter(log => new Date(log.timestamp) >= todayStart);
        const weekLogs = logs.filter(log => new Date(log.timestamp) >= weekStart);

        // Critical actions today
        const criticalActions = todayLogs.filter(log =>
            CRITICAL_ACTIONS.includes(log.action)
        );

        // Active users today (filter out empty/anonymous and normalize)
        const activeUsersToday = [...new Set(
            todayLogs
                .map(log => (log.userId || '').toLowerCase())
                .filter(userId => userId && userId.length > 0 && !userId.includes('anonymous'))
        )];

        // Sessions today (login events)
        const loginEvents = todayLogs.filter(log => log.action === 'USER_LOGIN');
        const logoutEvents = todayLogs.filter(log => log.action === 'USER_LOGOUT');

        // Calculate average session duration from logout events
        let totalSessionMinutes = 0;
        let sessionCount = 0;
        logoutEvents.forEach(logout => {
            const duration = logout.details?.durationSeconds as number;
            if (duration) {
                totalSessionMinutes += duration / 60;
                sessionCount++;
            }
        });
        const avgSessionMinutes = sessionCount > 0 ? totalSessionMinutes / sessionCount : 0;

        // Action breakdown
        const actionBreakdown = {} as Record<AuditAction, number>;
        logs.forEach(log => {
            actionBreakdown[log.action] = (actionBreakdown[log.action] || 0) + 1;
        });

        // Hourly activity (today)
        const hourlyActivity = new Array(24).fill(0);
        todayLogs.forEach(log => {
            const hour = new Date(log.timestamp).getHours();
            hourlyActivity[hour]++;
        });

        // Top users (all time from provided logs)
        const userCounts: Record<string, number> = {};
        logs.forEach(log => {
            if (log.userId && !log.userId.includes('anonymous')) {
                userCounts[log.userId] = (userCounts[log.userId] || 0) + 1;
            }
        });
        const topUsers = Object.entries(userCounts)
            .map(([email, count]) => ({ email, count }))
            .sort((a, b) => b.count - a.count)
            .slice(0, 5);

        return {
            todayCount: todayLogs.length,
            thisWeekCount: weekLogs.length,
            criticalCount: criticalActions.length,
            activeUsersToday,
            activeUserCount: activeUsersToday.length,
            avgSessionMinutes: Math.round(avgSessionMinutes),
            totalSessionsToday: loginEvents.length,
            actionBreakdown,
            hourlyActivity,
            topUsers,
            criticalActions
        };
    }, [logs]);
};

/**
 * Format minutes to human readable duration
 */
export const formatDuration = (minutes: number): string => {
    if (minutes < 60) return `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
};

/**
 * Get action criticality
 */
export const getActionCriticality = (action: AuditAction): 'critical' | 'important' | 'info' => {
    if (CRITICAL_ACTIONS.includes(action)) return 'critical';
    if (IMPORTANT_ACTIONS.includes(action)) return 'important';
    return 'info';
};
