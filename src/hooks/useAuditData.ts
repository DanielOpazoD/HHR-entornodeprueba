/**
 * useAuditData Hook
 *
 * Extracted from AuditView.tsx to manage audit log state, filtering, grouping, and pagination.
 * This improves separation of concerns and testability.
 */

import { useState, useEffect, useMemo, useCallback } from 'react';
import { AuditAction, AuditSection } from '@/types/auditActionTypes';
import {
  AuditLogEntry,
  GroupedAuditLogEntry,
  WorkerFilterParams,
  AuditStats,
} from '@/types/auditLogTypes';
import { useAuditWorker } from './useAuditWorker';
import { AUDIT_ACTION_LABELS, CRITICAL_ACTIONS } from '@/services/admin/auditConstants';
import { executeFetchAuditLogs } from '@/application/audit/fetchAuditLogsUseCase';
import {
  buildDefaultAuditStats,
  buildAuditSectionActionsMap,
  buildAuditWorkerFilterParams,
  paginateAuditDisplayLogs,
  resolveAuditLogsFallback,
  shouldResetAuditPagination,
  toggleAuditRowState,
} from '@/hooks/controllers/auditDataPolicyController';
import {
  buildAuditPatientPackagePipelineBase,
  queryAuditPatientPackagePipeline,
} from '@/hooks/controllers/auditPatientPackagePipelineController';
import {
  AUDIT_DEFAULT_FETCH_LIMIT,
  AUDIT_FETCH_LIMIT_STEP,
  AUDIT_MAX_FETCH_LIMIT,
  AUDIT_ITEMS_PER_PAGE,
  AUDIT_SECTIONS,
  type AuditSectionConfig,
} from '@/services/admin/auditViewConfig';
import {
  resolveAuditDateRangePreset,
  type AuditDateRangePreset,
} from '@/services/admin/auditDateRangePresets';
import { auditDataLogger } from '@/hooks/hookLoggers';
import { type ClinicalAuditPatientPackage } from '@/services/admin/clinicalAuditPatientPackages';
import {
  DEFAULT_PATIENT_PACKAGE_INTENT,
  type ClinicalAuditPatientPackageFilterId,
  type ClinicalAuditPatientPackageFilterOption,
  type ClinicalAuditPatientPackageIntentId,
  type ClinicalAuditPatientPackageIntentOption,
} from '@/services/admin/clinicalAuditPatientPackageFilters';
import { filterLogs as filterAuditLogs } from '@/services/admin/auditWorkerLogic';

export { AUDIT_SECTIONS } from '@/services/admin/auditViewConfig';

export type SectionConfig = AuditSectionConfig;

export interface AuditFiltersState {
  searchTerm: string;
  filterAction: AuditAction | 'ALL';
  startDate: string;
  endDate: string;
  activeSection: AuditSection;
  compactView: boolean;
  groupedView: boolean;
  activePatientPackageFilter: ClinicalAuditPatientPackageFilterId;
  activePatientPackageIntent: ClinicalAuditPatientPackageIntentId;
}

export interface UseAuditDataReturn {
  // Data
  logs: AuditLogEntry[];
  filteredLogs: AuditLogEntry[];
  displayLogs: (AuditLogEntry | GroupedAuditLogEntry)[];
  paginatedLogs: (AuditLogEntry | GroupedAuditLogEntry)[];
  patientPackages: ClinicalAuditPatientPackage[];
  paginatedPatientPackages: ClinicalAuditPatientPackage[];
  patientPackageFilterOptions: ClinicalAuditPatientPackageFilterOption[];
  patientPackageIntentOptions: ClinicalAuditPatientPackageIntentOption[];
  stats: AuditStats;

  // Loading state
  loading: boolean;
  isProcessing: boolean;
  fetchLimit: number;
  canLoadMoreLogs: boolean;

  // Filters
  filters: AuditFiltersState;
  setSearchTerm: (value: string) => void;
  setFilterAction: (value: AuditAction | 'ALL') => void;
  setStartDate: (value: string) => void;
  setEndDate: (value: string) => void;
  applyDateRangePreset: (preset: AuditDateRangePreset) => void;
  setActiveSection: (value: AuditSection) => void;
  setCompactView: (value: boolean) => void;
  setGroupedView: (value: boolean) => void;
  setActivePatientPackageFilter: (value: ClinicalAuditPatientPackageFilterId) => void;
  setActivePatientPackageIntent: (value: ClinicalAuditPatientPackageIntentId) => void;

  // Pagination
  currentPage: number;
  totalPages: number;
  setCurrentPage: (page: number) => void;

  // Row expansion
  expandedRows: Set<string>;
  toggleRow: (id: string) => void;
  showMetadata: Set<string>;
  toggleMetadata: (id: string) => void;

  // Actions
  fetchLogs: () => Promise<void>;
  loadMoreLogs: () => void;

  // Constants
  sections: Record<AuditSection, SectionConfig>;
  ITEMS_PER_PAGE: number;
}

export function useAuditData(): UseAuditDataReturn {
  const ITEMS_PER_PAGE = AUDIT_ITEMS_PER_PAGE;

  // Core data state
  const [logs, setLogs] = useState<AuditLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchLimit, setFetchLimit] = useState(AUDIT_DEFAULT_FETCH_LIMIT);

  // Filter state
  const [searchTerm, setSearchTerm] = useState('');
  const [filterAction, setFilterAction] = useState<AuditAction | 'ALL'>('ALL');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [activeSection, setActiveSection] = useState<AuditSection>('ALL');
  const [compactView, setCompactView] = useState(false);
  const [groupedView, setGroupedView] = useState(true);
  const [activePatientPackageFilter, setActivePatientPackageFilter] =
    useState<ClinicalAuditPatientPackageFilterId>('ALL');
  const [activePatientPackageIntent, setActivePatientPackageIntentState] =
    useState<ClinicalAuditPatientPackageIntentId>(DEFAULT_PATIENT_PACKAGE_INTENT);

  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);

  // Row expansion state
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [showMetadata, setShowMetadata] = useState<Set<string>>(new Set());

  // Audit Worker integration
  const { results, isProcessing, processData } = useAuditWorker();

  // Fetch logs from service
  const fetchLogs = useCallback(async () => {
    setLoading(true);
    try {
      const result = await executeFetchAuditLogs({ limit: fetchLimit });
      setLogs(resolveAuditLogsFallback(result.data));
      if (result.status === 'failed') {
        auditDataLogger.error('Failed to fetch audit logs', result.issues[0]?.message);
      }
    } catch (error) {
      auditDataLogger.error('Failed to fetch audit logs', error);
      setLogs([]);
    } finally {
      setLoading(false);
    }
  }, [fetchLimit]);

  const loadMoreLogs = useCallback(() => {
    setFetchLimit(currentLimit =>
      Math.min(currentLimit + AUDIT_FETCH_LIMIT_STEP, AUDIT_MAX_FETCH_LIMIT)
    );
  }, []);

  // Initial fetch
  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  // Process data whenever logs or filters change
  useEffect(() => {
    const params: WorkerFilterParams = buildAuditWorkerFilterParams({
      searchTerm,
      filterAction,
      startDate,
      endDate,
      activeSection,
      sectionActions: buildAuditSectionActionsMap(AUDIT_SECTIONS),
      groupedView,
    });

    processData(logs, params, AUDIT_ACTION_LABELS, CRITICAL_ACTIONS);
  }, [logs, searchTerm, filterAction, activeSection, startDate, endDate, groupedView, processData]);

  // Row toggle handlers
  const toggleRow = useCallback((id: string) => {
    setExpandedRows(prev => toggleAuditRowState(prev, id));
  }, []);

  const toggleMetadata = useCallback((id: string) => {
    setShowMetadata(prev => toggleAuditRowState(prev, id));
  }, []);

  const applyDateRangePreset = useCallback((preset: AuditDateRangePreset) => {
    const range = resolveAuditDateRangePreset(preset);
    setStartDate(range.startDate);
    setEndDate(range.endDate);
  }, []);

  const setActivePatientPackageIntent = useCallback(
    (value: ClinicalAuditPatientPackageIntentId) => {
      setActivePatientPackageIntentState(value);
      setActivePatientPackageFilter('ALL');
    },
    []
  );

  const { filteredLogs, displayLogs, stats: workerStats } = results;

  const patientPackageSourceLogs = useMemo(() => {
    const params: WorkerFilterParams = buildAuditWorkerFilterParams({
      searchTerm: '',
      filterAction,
      startDate,
      endDate,
      activeSection,
      sectionActions: buildAuditSectionActionsMap(AUDIT_SECTIONS),
      groupedView,
    });

    return filterAuditLogs(logs, params);
  }, [logs, filterAction, activeSection, startDate, endDate, groupedView]);

  const patientPackagePipelineBase = useMemo(
    () => buildAuditPatientPackagePipelineBase({ sourceLogs: patientPackageSourceLogs }),
    [patientPackageSourceLogs]
  );

  const patientPackagePipeline = useMemo(
    () =>
      queryAuditPatientPackagePipeline({
        base: patientPackagePipelineBase,
        searchTerm,
        activeFilter: activePatientPackageFilter,
        activeIntent: activePatientPackageIntent,
        currentPage,
        itemsPerPage: ITEMS_PER_PAGE,
      }),
    [
      patientPackagePipelineBase,
      searchTerm,
      activePatientPackageFilter,
      activePatientPackageIntent,
      currentPage,
      ITEMS_PER_PAGE,
    ]
  );

  const {
    patientPackages,
    paginatedPatientPackages,
    patientPackageFilterOptions,
    patientPackageIntentOptions,
  } = patientPackagePipeline;

  // Pagination
  const activeDisplayCount = groupedView
    ? patientPackagePipeline.activeDisplayCount
    : displayLogs.length;
  const totalPages = Math.ceil(activeDisplayCount / ITEMS_PER_PAGE);

  const paginatedLogs = useMemo(() => {
    return paginateAuditDisplayLogs(displayLogs, currentPage, ITEMS_PER_PAGE);
  }, [displayLogs, currentPage, ITEMS_PER_PAGE]);

  const canLoadMoreLogs = logs.length >= fetchLimit && fetchLimit < AUDIT_MAX_FETCH_LIMIT;

  // Reset page when filters change
  useEffect(() => {
    if (
      shouldResetAuditPagination({
        searchTerm,
        filterAction,
        activeSection,
        startDate,
        endDate,
        groupedView,
        activePatientPackageFilter,
        activePatientPackageIntent,
      })
    ) {
      setCurrentPage(1);
    }
  }, [
    searchTerm,
    filterAction,
    activeSection,
    startDate,
    endDate,
    groupedView,
    activePatientPackageFilter,
    activePatientPackageIntent,
  ]);

  // Use stats from worker
  const stats = (workerStats || buildDefaultAuditStats()) as AuditStats;

  // Compose filters state object
  const filters: AuditFiltersState = {
    searchTerm,
    filterAction,
    startDate,
    endDate,
    activeSection,
    compactView,
    groupedView,
    activePatientPackageFilter,
    activePatientPackageIntent,
  };

  return {
    // Data
    logs,
    filteredLogs,
    displayLogs,
    paginatedLogs,
    patientPackages,
    paginatedPatientPackages,
    patientPackageFilterOptions,
    patientPackageIntentOptions,
    stats,

    // Loading
    loading,
    isProcessing,
    fetchLimit,
    canLoadMoreLogs,

    // Filters
    filters,
    setSearchTerm,
    setFilterAction,
    setStartDate,
    setEndDate,
    applyDateRangePreset,
    setActiveSection,
    setCompactView,
    setGroupedView,
    setActivePatientPackageFilter,
    setActivePatientPackageIntent,

    // Pagination
    currentPage,
    totalPages,
    setCurrentPage,

    // Row expansion
    expandedRows,
    toggleRow,
    showMetadata,
    toggleMetadata,

    // Actions
    fetchLogs,
    loadMoreLogs,

    // Constants
    sections: AUDIT_SECTIONS,
    ITEMS_PER_PAGE,
  };
}
