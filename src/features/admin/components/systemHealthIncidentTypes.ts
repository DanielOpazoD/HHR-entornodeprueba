import type {
  SystemHealthIncidentResolutionHistoryEntry,
  SystemHealthIncidentResolutionState,
  UserHealthEventSeverity,
  UserHealthRecentEvent,
  UserHealthStatus,
} from '@/services/admin/healthService';

export type SystemHealthDateRange = 'all' | 'day' | 'last24h' | 'last7d';
export type SystemHealthSeverityFilter = 'all' | UserHealthEventSeverity | 'healthy';
export type SystemHealthEventTypeFilter =
  | 'all'
  | 'sync'
  | 'local_error'
  | 'operational'
  | 'sync_conflict';

export interface SystemHealthTriageFilters {
  searchTerm: string;
  dateRange: SystemHealthDateRange;
  severity: SystemHealthSeverityFilter;
  eventType: SystemHealthEventTypeFilter;
  selectedDate?: string;
  nowMs?: number;
}

export interface SystemHealthIncidentRow {
  id: string;
  resolutionKey: string;
  title: string;
  timestamp: string;
  source: UserHealthRecentEvent['source'];
  category: UserHealthRecentEvent['category'];
  sourceLabel: string;
  categoryLabel: string;
  severity: UserHealthEventSeverity;
  status: UserHealthRecentEvent['status'];
  statusLabel: string;
  originLabel: string;
  actionLabel: string;
  routeLabel: string;
  userLabel: string;
  userUid: string;
  userEmail: string;
  resolvedAt?: string;
  resolvedByName?: string;
  resolutionNote?: string;
  resolutionHistory?: SystemHealthIncidentResolutionHistoryEntry[];
  details: string[];
}

export interface SystemHealthIncidentQueueRow extends SystemHealthIncidentRow {
  healthLevel: 'healthy' | 'warning' | 'critical';
}

export interface SystemHealthIncidentGroup {
  id: string;
  title: string;
  categoryLabel: string;
  originLabel: string;
  actionLabel: string;
  routeLabel: string;
  severity: UserHealthEventSeverity;
  status: UserHealthRecentEvent['status'] | 'recurrent';
  statusLabel: string;
  occurrenceCount: number;
  affectedUsers: number;
  firstSeenAt: string;
  lastSeenAt: string;
  userLabels: string[];
}

export interface SystemHealthIncidentTimelineDay {
  date: string;
  totalIncidents: number;
  criticalIncidents: number;
  warningIncidents: number;
  affectedUsers: number;
  firstSeenAt: string;
  lastSeenAt: string;
  durationMinutes: number;
}

export interface SystemHealthTriageTotals {
  totalIncidents: number;
  criticalIncidents: number;
  warningIncidents: number;
  affectedUsers: number;
  openIncidents: number;
  recoveredIncidents: number;
  resolvedIncidents: number;
}

export interface SystemHealthUserTriage {
  user: UserHealthStatus;
  healthLevel: 'healthy' | 'warning' | 'critical';
  incidents: SystemHealthIncidentRow[];
  latestIncidentAt?: string;
  criticalCount: number;
  warningCount: number;
}

export interface SystemHealthTriageModel {
  filteredUsers: UserHealthStatus[];
  selectedUser?: UserHealthStatus;
  selectedIncidents: SystemHealthIncidentRow[];
  userTriage: SystemHealthUserTriage[];
  incidentQueue: SystemHealthIncidentQueueRow[];
  incidentGroups: SystemHealthIncidentGroup[];
  timeline: SystemHealthIncidentTimelineDay[];
  totals: SystemHealthTriageTotals;
}

export interface BuildSystemHealthTriageModelParams {
  selectedUid: string | null;
  filters: SystemHealthTriageFilters;
  resolutionState?: SystemHealthIncidentResolutionState;
}
