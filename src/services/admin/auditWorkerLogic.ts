import type {
  AuditLogEntry,
  AuditStats,
  GroupedAuditLogEntry,
  WorkerFilterParams,
} from '@/types/auditLogTypes';

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
  const { searchTerm, filterAction, startDate, endDate, activeSection, sectionActions } = params;
  const searchLower = searchTerm.toLowerCase();

  return logs.filter(log => {
    const logDate = parseAuditTimestamp(log.timestamp);
    const patientName = (log.details?.patientName as string) || '';

    // 1. Global Search
    const matchesSearch =
      !searchTerm ||
      (log.patientIdentifier || '').toLowerCase().includes(searchLower) ||
      ((log.details?.rut as string) || '').toLowerCase().includes(searchLower) ||
      patientName.toLowerCase().includes(searchLower) ||
      (log.userDisplayName || '').toLowerCase().includes(searchLower) ||
      (log.userId || '').toLowerCase().includes(searchLower);

    // 2. Action Filter
    const matchesFilter = filterAction === 'ALL' || log.action === filterAction;

    // 3. Section categorization
    const actions = sectionActions[activeSection];
    const matchesSection = activeSection === 'ALL' || (actions && actions.includes(log.action));

    // 4. Date Filter
    const matchesDate =
      (!startDate || logDate >= new Date(startDate)) &&
      (!endDate || logDate <= new Date(endDate + 'T23:59:59'));

    return matchesSearch && matchesFilter && matchesDate && matchesSection;
  });
};

/**
 * Group logs
 */
const AUDIT_BURST_WINDOW_MS = 10 * 60 * 1000;

const resolveBurstGroupBaseKey = (log: AuditLogEntry): string => {
  const userIdStr = (log.userId || 'unknown').trim();
  const ipStr = (log.ipAddress || 'unknown-ip').trim();
  const actionStr = (log.action || '').trim();

  return `${userIdStr}-${ipStr}-${actionStr}`;
};

export const groupLogs = (
  filteredLogs: AuditLogEntry[],
  actionLabels: Record<string, string>
): (AuditLogEntry | GroupedAuditLogEntry)[] => {
  const groups: Record<string, AuditLogEntry[]> = {};

  const sortedLogs = [...filteredLogs].sort(
    (a, b) =>
      parseAuditTimestamp(a.timestamp).getTime() - parseAuditTimestamp(b.timestamp).getTime()
  );

  sortedLogs.forEach(log => {
    const baseKey = resolveBurstGroupBaseKey(log);
    const logTime = parseAuditTimestamp(log.timestamp).getTime();
    const existingGroupKey = Object.keys(groups).find(groupKey => {
      if (!groupKey.startsWith(`${baseKey}-`)) return false;

      const group = groups[groupKey];
      const firstTime = parseAuditTimestamp(group[0].timestamp).getTime();
      const lastTime = parseAuditTimestamp(group[group.length - 1].timestamp).getTime();

      return (
        logTime - firstTime < AUDIT_BURST_WINDOW_MS && logTime - lastTime < AUDIT_BURST_WINDOW_MS
      );
    });

    if (existingGroupKey) {
      groups[existingGroupKey].push(log);
      return;
    }

    groups[`${baseKey}-${logTime}`] = [log];
  });

  return Object.entries(groups)
    .map(([key, group]) => {
      const first = group[0];
      const last = group[group.length - 1];

      if (group.length === 1) return first;

      return {
        ...first,
        id: `group-${key}`,
        timestamp: last.timestamp,
        summary: `${actionLabels[first.action] || first.action} (${group.length} registros en 10 min)`,
        isGroup: true,
        childLogs: [...group].sort(
          (a, b) =>
            parseAuditTimestamp(b.timestamp).getTime() - parseAuditTimestamp(a.timestamp).getTime()
        ),
      } as GroupedAuditLogEntry;
    })
    .sort((a, b) => {
      const dateA = parseAuditTimestamp(a.timestamp);
      const dateB = parseAuditTimestamp(b.timestamp);
      return dateB.getTime() - dateA.getTime();
    });
};

/**
 * Calculate statistics
 */
export const calculateAuditStats = (
  logs: AuditLogEntry[],
  criticalActions: string[]
): AuditStats => {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const weekStart = new Date(todayStart);
  weekStart.setDate(weekStart.getDate() - 7);

  const todayLogs = logs.filter(log => parseAuditTimestamp(log.timestamp) >= todayStart);
  const weekLogs = logs.filter(log => parseAuditTimestamp(log.timestamp) >= weekStart);

  const todayCritical = todayLogs.filter(log => criticalActions.includes(log.action));

  const activeUsersToday = [
    ...new Set(
      todayLogs
        .map(log => (log.userId || '').toLowerCase())
        .filter(userId => userId && userId.length > 0 && !userId.includes('anonymous'))
    ),
  ];

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
    criticalActions: todayCritical,
  };
};
