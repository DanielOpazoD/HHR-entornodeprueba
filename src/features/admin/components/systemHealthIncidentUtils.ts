import { evaluateSystemHealthState } from './systemHealthStatusPolicy';
import type { UserHealthStatus } from '@/services/admin/healthService';
import {
  buildSystemHealthIncidentRows,
  labelFor,
  resolveSystemHealthIncidentRow,
  severityRank,
  STATUS_LABELS,
  statusRank,
  toMs,
} from './systemHealthIncidentRows';
import type {
  BuildSystemHealthTriageModelParams,
  SystemHealthDateRange,
  SystemHealthEventTypeFilter,
  SystemHealthIncidentGroup,
  SystemHealthIncidentQueueRow,
  SystemHealthIncidentRow,
  SystemHealthIncidentTimelineDay,
  SystemHealthSeverityFilter,
  SystemHealthTriageFilters,
  SystemHealthTriageModel,
} from './systemHealthIncidentTypes';

export type {
  BuildSystemHealthTriageModelParams,
  SystemHealthDateRange,
  SystemHealthEventTypeFilter,
  SystemHealthIncidentGroup,
  SystemHealthIncidentQueueRow,
  SystemHealthIncidentRow,
  SystemHealthIncidentTimelineDay,
  SystemHealthSeverityFilter,
  SystemHealthTriageFilters,
  SystemHealthTriageModel,
  SystemHealthTriageTotals,
  SystemHealthUserTriage,
} from './systemHealthIncidentTypes';
export { buildSystemHealthIncidentRows, resolveSystemHealthIncidentRow };

const isWithinDateRange = (
  timestamp: string | undefined,
  dateRange: SystemHealthDateRange,
  selectedDate: string | undefined,
  nowMs: number
): boolean => {
  if (dateRange === 'all') return true;
  if (dateRange === 'day') {
    return !!selectedDate && !!timestamp && timestamp.slice(0, 10) === selectedDate;
  }
  const eventMs = toMs(timestamp);
  if (eventMs <= 0) return false;
  const maxAgeMs = dateRange === 'last24h' ? 24 * 60 * 60 * 1000 : 7 * 24 * 60 * 60 * 1000;
  return nowMs - eventMs <= maxAgeMs;
};

const userMatchesSearch = (
  user: UserHealthStatus,
  rows: SystemHealthIncidentRow[],
  searchTerm: string
): boolean => {
  const normalized = searchTerm.trim().toLowerCase();
  if (!normalized) return true;
  return [
    user.displayName,
    user.email,
    user.uid,
    ...rows.flatMap(row => [
      row.title,
      row.categoryLabel,
      row.originLabel,
      row.actionLabel,
      row.routeLabel,
      ...row.details,
    ]),
  ].some(value =>
    String(value || '')
      .toLowerCase()
      .includes(normalized)
  );
};

const userMatchesSeverity = (
  user: UserHealthStatus,
  rows: SystemHealthIncidentRow[],
  severity: SystemHealthSeverityFilter
): boolean => {
  if (severity === 'all') return true;
  if (severity === 'healthy') return evaluateSystemHealthState(user).level === 'healthy';
  return rows.some(row => row.severity === severity);
};

const userMatchesEventType = (
  rows: SystemHealthIncidentRow[],
  eventType: SystemHealthEventTypeFilter
): boolean => {
  if (eventType === 'all') return true;
  if (eventType === 'operational') {
    return rows.some(row => row.source === 'operational');
  }
  return rows.some(row => row.category === eventType);
};

export const filterSystemHealthStatsForTriage = (
  stats: UserHealthStatus[],
  filters: SystemHealthTriageFilters
): UserHealthStatus[] => {
  const nowMs = filters.nowMs || Date.now();

  return stats.filter(user => {
    const rows = buildSystemHealthIncidentRows(user);
    const relevantTimestamp = rows[0]?.timestamp || user.latestOperationalIssueAt || user.lastSeen;
    return (
      userMatchesSearch(user, rows, filters.searchTerm) &&
      isWithinDateRange(relevantTimestamp, filters.dateRange, filters.selectedDate, nowMs) &&
      userMatchesSeverity(user, rows, filters.severity) &&
      userMatchesEventType(rows, filters.eventType)
    );
  });
};

const buildIncidentCauseKey = (incident: SystemHealthIncidentRow): string =>
  [
    incident.category,
    incident.originLabel,
    incident.actionLabel,
    incident.routeLabel,
    incident.title.trim().toLowerCase(),
  ].join('|');

export const buildSystemHealthIncidentGroups = (
  incidents: SystemHealthIncidentQueueRow[]
): SystemHealthIncidentGroup[] => {
  const groups = new Map<string, SystemHealthIncidentQueueRow[]>();
  incidents.forEach(incident => {
    const key = buildIncidentCauseKey(incident);
    groups.set(key, [...(groups.get(key) || []), incident]);
  });

  return Array.from(groups.entries())
    .map(([id, groupIncidents]) => {
      const orderedByTime = [...groupIncidents].sort(
        (a, b) => toMs(a.timestamp) - toMs(b.timestamp)
      );
      const orderedBySeverity = [...groupIncidents].sort(
        (a, b) => severityRank(a.severity) - severityRank(b.severity)
      );
      const representative = orderedBySeverity[0];
      const userLabels = Array.from(new Set(groupIncidents.map(incident => incident.userLabel)));
      const hasOpen = groupIncidents.some(incident => incident.status === 'open');
      const allResolved = groupIncidents.every(incident => incident.status === 'resolved');
      const status: SystemHealthIncidentGroup['status'] =
        groupIncidents.length > 1 && hasOpen
          ? 'recurrent'
          : allResolved
            ? 'resolved'
            : representative.status;

      return {
        id,
        title: representative.title,
        categoryLabel: representative.categoryLabel,
        originLabel: representative.originLabel,
        actionLabel: representative.actionLabel,
        routeLabel: representative.routeLabel,
        severity: representative.severity,
        status,
        statusLabel:
          status === 'recurrent' ? 'Recurrente' : labelFor(STATUS_LABELS, status, 'Abierto'),
        occurrenceCount: groupIncidents.length,
        affectedUsers: userLabels.length,
        firstSeenAt: orderedByTime[0]?.timestamp || representative.timestamp,
        lastSeenAt: orderedByTime[orderedByTime.length - 1]?.timestamp || representative.timestamp,
        userLabels,
      };
    })
    .sort((a, b) => {
      const statusDelta =
        (a.status === 'recurrent' ? -1 : statusRank(a.status)) -
        (b.status === 'recurrent' ? -1 : statusRank(b.status));
      if (statusDelta !== 0) return statusDelta;
      const severityDelta = severityRank(a.severity) - severityRank(b.severity);
      if (severityDelta !== 0) return severityDelta;
      if (b.occurrenceCount !== a.occurrenceCount) return b.occurrenceCount - a.occurrenceCount;
      return toMs(b.lastSeenAt) - toMs(a.lastSeenAt);
    });
};

export const buildSystemHealthIncidentTimeline = (
  incidents: SystemHealthIncidentRow[]
): SystemHealthIncidentTimelineDay[] => {
  const groupedByDate = new Map<string, SystemHealthIncidentRow[]>();
  incidents.forEach(incident => {
    const date = incident.timestamp.slice(0, 10);
    if (!date) return;
    groupedByDate.set(date, [...(groupedByDate.get(date) || []), incident]);
  });

  return Array.from(groupedByDate.entries())
    .map(([date, dayIncidents]) => {
      const ordered = [...dayIncidents].sort((a, b) => toMs(a.timestamp) - toMs(b.timestamp));
      const firstSeenAt = ordered[0]?.timestamp || '';
      const lastSeenAt = ordered[ordered.length - 1]?.timestamp || firstSeenAt;
      const durationMs = Math.max(0, toMs(lastSeenAt) - toMs(firstSeenAt));

      return {
        date,
        totalIncidents: dayIncidents.length,
        criticalIncidents: dayIncidents.filter(incident => incident.severity === 'critical').length,
        warningIncidents: dayIncidents.filter(incident => incident.severity === 'warning').length,
        affectedUsers: new Set(dayIncidents.map(incident => incident.userUid)).size,
        firstSeenAt,
        lastSeenAt,
        durationMinutes: Math.round(durationMs / 60000),
      };
    })
    .sort((a, b) => b.date.localeCompare(a.date));
};

const csvEscape = (value: unknown): string => {
  const text = String(value ?? '');
  return `"${text.replace(/"/g, '""')}"`;
};

export const exportSystemHealthIncidentsCsv = (incidents: SystemHealthIncidentRow[]): string => {
  const header = [
    'fecha_hora',
    'usuario',
    'email',
    'severidad',
    'estado',
    'tipo',
    'origen',
    'accion',
    'ruta',
    'titulo',
    'detalles',
  ].join(',');
  const rows = incidents.map(incident =>
    [
      incident.timestamp,
      incident.userLabel,
      incident.userEmail,
      incident.severity,
      incident.statusLabel,
      incident.categoryLabel,
      incident.originLabel,
      incident.actionLabel,
      incident.routeLabel,
      incident.title,
      incident.details.join(' | '),
    ]
      .map(csvEscape)
      .join(',')
  );
  return [header, ...rows].join('\n');
};

export const buildSystemHealthTriageModel = (
  stats: UserHealthStatus[],
  { selectedUid, filters, resolutionState = {} }: BuildSystemHealthTriageModelParams
): SystemHealthTriageModel => {
  const filteredUsers = filterSystemHealthStatsForTriage(stats, filters);
  const userTriage = filteredUsers.map(user => {
    const incidents = buildSystemHealthIncidentRows(user).map(incident =>
      resolveSystemHealthIncidentRow(incident, resolutionState[incident.resolutionKey])
    );
    return {
      user,
      healthLevel: evaluateSystemHealthState(user).level,
      incidents,
      latestIncidentAt: incidents[0]?.timestamp,
      criticalCount: incidents.filter(incident => incident.severity === 'critical').length,
      warningCount: incidents.filter(incident => incident.severity === 'warning').length,
    };
  });
  const selectedUser =
    filteredUsers.find(user => user.uid === selectedUid) || filteredUsers[0] || undefined;
  const selectedIncidents = selectedUser
    ? buildSystemHealthIncidentRows(selectedUser).map(incident =>
        resolveSystemHealthIncidentRow(incident, resolutionState[incident.resolutionKey])
      )
    : [];
  const incidentQueue = userTriage
    .flatMap(triage =>
      triage.incidents.map(incident => ({
        ...incident,
        healthLevel: triage.healthLevel,
      }))
    )
    .sort((a, b) => {
      const statusDelta = statusRank(a.status) - statusRank(b.status);
      if (statusDelta !== 0) return statusDelta;
      const severityDelta = severityRank(a.severity) - severityRank(b.severity);
      if (severityDelta !== 0) return severityDelta;
      return toMs(b.timestamp) - toMs(a.timestamp);
    });
  const incidentGroups = buildSystemHealthIncidentGroups(incidentQueue);
  const timeline = buildSystemHealthIncidentTimeline(incidentQueue);

  return {
    filteredUsers,
    selectedUser,
    selectedIncidents,
    userTriage,
    incidentQueue,
    incidentGroups,
    timeline,
    totals: {
      totalIncidents: incidentQueue.length,
      criticalIncidents: incidentQueue.filter(incident => incident.severity === 'critical').length,
      warningIncidents: incidentQueue.filter(incident => incident.severity === 'warning').length,
      affectedUsers: userTriage.filter(triage => triage.incidents.length > 0).length,
      openIncidents: incidentQueue.filter(incident => incident.status === 'open').length,
      recoveredIncidents: incidentQueue.filter(incident => incident.status === 'recovered').length,
      resolvedIncidents: incidentQueue.filter(incident => incident.status === 'resolved').length,
    },
  };
};

export const shiftSystemHealthSelectedDate = (selectedDate: string, deltaDays: number): string => {
  const sourceDate = selectedDate ? new Date(`${selectedDate}T00:00:00.000Z`) : new Date();
  if (Number.isNaN(sourceDate.getTime())) return selectedDate;
  sourceDate.setUTCDate(sourceDate.getUTCDate() + deltaDays);
  return sourceDate.toISOString().slice(0, 10);
};
