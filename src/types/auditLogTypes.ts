import type { AuditAction, AuditSection } from './auditActionTypes';
import type { AuditDetails } from './auditDetailTypes';

export interface AuditLogEntry {
  id: string;
  timestamp: string;
  userId: string;
  userDisplayName?: string;
  userUid?: string;
  ipAddress?: string;
  action: AuditAction;
  entityType:
    | 'patient'
    | 'discharge'
    | 'transfer'
    | 'dailyRecord'
    | 'user'
    | 'system'
    | 'clinicalDocument'
    | 'prescription'
    | 'medicalIndicationRecord'
    | 'medicalIndicationTemplate'
    | 'statistics';
  entityId: string;
  summary?: string;
  details: AuditDetails;
  patientIdentifier?: string;
  recordDate?: string;
  authors?: string;
}

export interface GroupedAuditLogEntry extends AuditLogEntry {
  isGroup: true;
  childLogs: AuditLogEntry[];
}

export const isGroupedAuditLogEntry = (log: AuditLogEntry): log is GroupedAuditLogEntry => {
  return 'isGroup' in log && log.isGroup === true;
};

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
  filterAction: AuditAction | 'ALL';
  startDate: string;
  endDate: string;
  activeSection: AuditSection;
  sectionActions: Record<string, string[] | undefined>;
  groupedView: boolean;
}

export const maskRut = (rut: string): string => {
  if (!rut || rut.length < 4) return '***';
  const parts = rut.split('-');
  if (parts.length === 2) {
    const body = parts[0];
    return body.slice(0, -3) + '***-*';
  }
  return rut.slice(0, -4) + '***';
};
