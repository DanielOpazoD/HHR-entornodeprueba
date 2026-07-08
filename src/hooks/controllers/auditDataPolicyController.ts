import type { AuditAction, AuditSection } from '@/types/auditActionTypes';
import type {
  AuditLogEntry,
  GroupedAuditLogEntry,
  WorkerFilterParams,
  AuditStats,
} from '@/types/auditLogTypes';
import type { AuditSectionConfig } from '@/services/admin/auditViewConfig';
import { DEFAULT_PATIENT_PACKAGE_INTENT } from '@/services/admin/clinicalAuditPatientPackageFilters';

export const buildDefaultAuditStats = (): AuditStats => ({
  todayCount: 0,
  thisWeekCount: 0,
  criticalCount: 0,
  activeUsersToday: [],
  activeUserCount: 0,
  avgSessionMinutes: 0,
  totalSessionsToday: 0,
  actionBreakdown: {},
  hourlyActivity: new Array(24).fill(0),
  topUsers: [],
  criticalActions: [],
});

export const resolveAuditLogsFallback = <T>(logs: T[], fallback: T[] = []): T[] =>
  Array.isArray(logs) ? logs : fallback;

export const shouldResetAuditPagination = (params: {
  searchTerm: string;
  filterAction: string;
  activeSection: string;
  startDate: string;
  endDate: string;
  groupedView: boolean;
  activePatientPackageFilter?: string;
  activePatientPackageIntent?: string;
}): boolean =>
  Boolean(
    params.searchTerm ||
    params.filterAction !== 'ALL' ||
    params.activeSection !== 'ALL' ||
    params.startDate ||
    params.endDate ||
    params.groupedView ||
    (params.activePatientPackageFilter && params.activePatientPackageFilter !== 'ALL') ||
    (params.activePatientPackageIntent &&
      params.activePatientPackageIntent !== DEFAULT_PATIENT_PACKAGE_INTENT)
  );

export const buildAuditSectionActionsMap = (
  sections: Record<AuditSection, AuditSectionConfig>
): Record<string, string[] | undefined> =>
  Object.fromEntries(Object.entries(sections).map(([key, config]) => [key, config.actions]));

export const buildAuditWorkerFilterParams = (params: {
  searchTerm: string;
  filterAction: AuditAction | 'ALL';
  startDate: string;
  endDate: string;
  activeSection: AuditSection;
  sectionActions: Record<string, string[] | undefined>;
  groupedView: boolean;
}): WorkerFilterParams => ({
  searchTerm: params.searchTerm,
  filterAction: params.filterAction,
  startDate: params.startDate,
  endDate: params.endDate,
  activeSection: params.activeSection,
  sectionActions: params.sectionActions,
  groupedView: params.groupedView,
});

export const paginateAuditDisplayLogs = (
  displayLogs: (AuditLogEntry | GroupedAuditLogEntry)[],
  currentPage: number,
  itemsPerPage: number
): (AuditLogEntry | GroupedAuditLogEntry)[] => {
  const startIndex = (currentPage - 1) * itemsPerPage;
  return displayLogs.slice(startIndex, startIndex + itemsPerPage);
};

export const toggleAuditRowState = (current: Set<string>, id: string): Set<string> => {
  const next = new Set(current);
  if (next.has(id)) {
    next.delete(id);
  } else {
    next.add(id);
  }
  return next;
};
