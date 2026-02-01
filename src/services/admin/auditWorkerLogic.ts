import { AuditLogEntry, AuditAction, GroupedAuditLogEntry } from '@/types/audit';

export interface AuditStats {
    todayCount: number;
    thisWeekCount: number;
    criticalCount: number;
    activeUsersToday: string[];
    activeUserCount: number;
    avgSessionMinutes: number;
    totalSessionsToday: number;
    actionBreakdown: Record<string, number>;
    hourlyActivity: number[];
    topUsers: { email: string; count: number }[];
    criticalActions: AuditLogEntry[];
}

export interface WorkerFilterParams {
    searchTerm: string;
    searchRut: string;
    filterAction: AuditAction | 'ALL';
    startDate: string;
    endDate: string;
    activeSection: string;
    sectionActions: Record<string, string[] | undefined>;
}

/**
 * Pure function to parse timestamps in a worker-safe way.
 * Doesn't rely on Firestore Timestamp class being present.
 */
export const parseAuditTimestamp = (timestamp: unknown): Date => {
    if (!timestamp) return new Date(0);

    if (typeof timestamp === 'object' && timestamp !== null) {
        const obj = timestamp as Record<string, unknown>;
        if ('toDate' in obj && typeof obj.toDate === 'function') {
            return obj.toDate();
        }
        if ('seconds' in obj && typeof obj.seconds === 'number') {
            return new Date(obj.seconds * 1000);
        }
        if (timestamp instanceof Date) {
            return timestamp;
        }
    }

    if (typeof timestamp === 'string' || typeof timestamp === 'number') {
        const date = new Date(timestamp);
        return isNaN(date.getTime()) ? new Date(0) : date;
    }

    return new Date(0);
};

/**
 * Filter logs based on parameters
 */
export const filterLogs = (logs: AuditLogEntry[], params: WorkerFilterParams): AuditLogEntry[] => {
    const { searchTerm, searchRut, filterAction, startDate, endDate, activeSection, sectionActions } = params;
    const searchLower = searchTerm.toLowerCase();
    const rutClean = searchRut.replace(/[^0-9kK]/g, '').toLowerCase();

    return logs.filter(log => {
        const logDate = parseAuditTimestamp(log.timestamp);
        const patientName = (log.details?.patientName as string) || '';

        // 1. RUT Search
        if (searchRut && searchRut.trim() !== '') {
            const rawLogRut = (log.details?.rut as string || '').replace(/[^0-9kK]/g, '').toLowerCase();
            if (rawLogRut && rawLogRut === rutClean) {
                // Match
            } else if (log.patientIdentifier?.includes('***')) {
                const maskedPrefix = log.patientIdentifier.split('*')[0].replace(/[^0-9kK]/g, '').toLowerCase();
                if (!(maskedPrefix && rutClean.startsWith(maskedPrefix))) {
                    return false;
                }
            } else {
                const logRutSimple = (log.patientIdentifier || '').replace(/[^0-9kK]/g, '').toLowerCase();
                if (logRutSimple !== rutClean) return false;
            }
        }

        // 2. Global Search
        const matchesSearch = !searchTerm ||
            (log.patientIdentifier || '').toLowerCase().includes(searchLower) ||
            (log.details?.rut as string || '').toLowerCase().includes(searchLower) ||
            patientName.toLowerCase().includes(searchLower) ||
            (log.userDisplayName || '').toLowerCase().includes(searchLower) ||
            (log.userId || '').toLowerCase().includes(searchLower);

        // 3. Action Filter
        const matchesFilter = filterAction === 'ALL' || log.action === filterAction;

        // 4. Section categorization
        const actions = sectionActions[activeSection];
        const matchesSection = activeSection === 'ALL' || (actions && actions.includes(log.action));

        // 5. Date Filter
        const matchesDate = (!startDate || logDate >= new Date(startDate)) &&
            (!endDate || logDate <= new Date(endDate + 'T23:59:59'));

        return matchesSearch && matchesFilter && matchesDate && matchesSection;
    });
};

/**
 * Group logs
 */
export const groupLogs = (
    filteredLogs: AuditLogEntry[],
    actionLabels: Record<string, string>
): (AuditLogEntry | GroupedAuditLogEntry)[] => {
    const groups: Record<string, AuditLogEntry[]> = {};

    filteredLogs.forEach(log => {
        const dateObj = parseAuditTimestamp(log.timestamp);
        const dateStr = log.recordDate || dateObj.toISOString().split('T')[0];
        const userIdStr = (log.userId || 'unknown').trim();
        const actionStr = (log.action || '').trim();
        const entityStr = (log.entityId || '').trim();

        const groupKey = `${userIdStr}-${actionStr}-${entityStr}-${dateStr}`;
        if (!groups[groupKey]) groups[groupKey] = [];
        groups[groupKey].push(log);
    });

    return Object.entries(groups).map(([key, group]) => {
        const first = group[0];
        const last = group[group.length - 1];

        if (group.length === 1) return first;

        return {
            ...first,
            id: `group-${key}`,
            timestamp: last.timestamp,
            summary: `${actionLabels[first.action] || first.action} (${group.length} registros)`,
            isGroup: true,
            childLogs: group
        } as GroupedAuditLogEntry;
    }).sort((a, b) => {
        const dateA = parseAuditTimestamp(a.timestamp);
        const dateB = parseAuditTimestamp(b.timestamp);
        return dateB.getTime() - dateA.getTime();
    });
};

/**
 * Calculate statistics
 */
export const calculateAuditStats = (logs: AuditLogEntry[], criticalActions: string[]): AuditStats => {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const weekStart = new Date(todayStart);
    weekStart.setDate(weekStart.getDate() - 7);

    const todayLogs = logs.filter(log => parseAuditTimestamp(log.timestamp) >= todayStart);
    const weekLogs = logs.filter(log => parseAuditTimestamp(log.timestamp) >= weekStart);

    const todayCritical = todayLogs.filter(log => criticalActions.includes(log.action));

    const activeUsersToday = [...new Set(
        todayLogs
            .map(log => (log.userId || '').toLowerCase())
            .filter(userId => userId && userId.length > 0 && !userId.includes('anonymous'))
    )];

    const loginEvents = todayLogs.filter(log => log.action === 'USER_LOGIN');
    const logoutEvents = todayLogs.filter(log => log.action === 'USER_LOGOUT');

    let totalSessionMinutes = 0;
    let sessionCount = 0;
    logoutEvents.forEach(logout => {
        const duration = logout.details?.durationSeconds as number;
        if (duration) {
            totalSessionMinutes += duration / 60;
            sessionCount++;
        }
    });

    const actionBreakdown: Record<string, number> = {};
    logs.forEach(log => {
        actionBreakdown[log.action] = (actionBreakdown[log.action] || 0) + 1;
    });

    const hourlyActivity = new Array(24).fill(0);
    todayLogs.forEach(log => {
        const hour = parseAuditTimestamp(log.timestamp).getHours();
        hourlyActivity[hour]++;
    });

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
        criticalCount: todayCritical.length,
        activeUsersToday,
        activeUserCount: activeUsersToday.length,
        avgSessionMinutes: Math.round(sessionCount > 0 ? totalSessionMinutes / sessionCount : 0),
        totalSessionsToday: loginEvents.length,
        actionBreakdown,
        hourlyActivity,
        topUsers,
        criticalActions: todayCritical
    };
};
