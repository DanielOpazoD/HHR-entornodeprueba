import { AuditAction, AuditSection } from '@/types/auditActionTypes';
import { AuditLogEntry, AuditStats } from '@/types/auditLogTypes';
import { CRITICAL_ACTIONS, IMPORTANT_ACTIONS } from '@/services/admin/auditConstants';
import { calculateAuditStats } from '@/services/admin/auditWorkerLogic';

export const buildAuditStats = (logs: AuditLogEntry[]): AuditStats => {
  return calculateAuditStats(logs, CRITICAL_ACTIONS);
};

export const formatDuration = (minutes: number): string => {
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
};

export const getActionCriticality = (action: AuditAction): 'critical' | 'important' | 'info' => {
  if (CRITICAL_ACTIONS.includes(action)) return 'critical';
  if (IMPORTANT_ACTIONS.includes(action)) return 'important';
  return 'info';
};

export const isAuditTableSection = (section: AuditSection): boolean =>
  !['EXPORT_KEYS', 'MAINTENANCE'].includes(section);
