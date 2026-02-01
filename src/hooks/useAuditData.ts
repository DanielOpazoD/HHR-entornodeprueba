/**
 * useAuditData Hook
 * 
 * Extracted from AuditView.tsx to manage audit log state, filtering, grouping, and pagination.
 * This improves separation of concerns and testability.
 */

import { useState, useEffect, useMemo, useCallback } from 'react';
import { getAuditLogs } from '@/services/admin/auditService';
import { AuditAction, AuditLogEntry, GroupedAuditLogEntry, AuditSection, WorkerFilterParams, AuditStats } from '@/types/audit';
import { useAuditWorker } from './useAuditWorker';
import { AUDIT_ACTION_LABELS, CRITICAL_ACTIONS } from '@/services/admin/auditConstants';

// ============================================================================
// Types
// ============================================================================

// Types are now imported from @/types/audit

export interface SectionConfig {
    label: string;
    color: string;
    actions?: string[];
}

export interface AuditFiltersState {
    searchTerm: string;
    searchRut: string;
    filterAction: AuditAction | 'ALL';
    startDate: string;
    endDate: string;
    activeSection: AuditSection;
    compactView: boolean;
    groupedView: boolean;
}

export interface UseAuditDataReturn {
    // Data
    logs: AuditLogEntry[];
    filteredLogs: AuditLogEntry[];
    displayLogs: (AuditLogEntry | GroupedAuditLogEntry)[];
    paginatedLogs: (AuditLogEntry | GroupedAuditLogEntry)[];
    stats: AuditStats;

    // Loading state
    loading: boolean;
    isProcessing: boolean;

    // Filters
    filters: AuditFiltersState;
    setSearchTerm: (value: string) => void;
    setSearchRut: (value: string) => void;
    setFilterAction: (value: AuditAction | 'ALL') => void;
    setStartDate: (value: string) => void;
    setEndDate: (value: string) => void;
    setActiveSection: (value: AuditSection) => void;
    setCompactView: (value: boolean) => void;
    setGroupedView: (value: boolean) => void;

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

    // Constants
    sections: Record<AuditSection, SectionConfig>;
    ITEMS_PER_PAGE: number;
}

// ============================================================================
// Section Definitions (Domain Constants)
// ============================================================================

export const AUDIT_SECTIONS: Record<AuditSection, SectionConfig> = {
    'ALL': { label: 'Todos', color: 'bg-slate-100 text-slate-600' },
    'TRACEABILITY': {
        label: '🏥 Trazabilidad',
        color: 'bg-cyan-100 text-cyan-700',
        actions: ['PATIENT_ADMITTED', 'PATIENT_DISCHARGED', 'PATIENT_TRANSFERRED', 'PATIENT_MODIFIED', 'BED_BLOCKED', 'BED_UNBLOCKED', 'MEDICAL_HANDOFF_SIGNED']
    },
    'TIMELINE': { label: '📅 Timeline', color: 'bg-violet-100 text-violet-700', actions: ['USER_LOGIN', 'USER_LOGOUT'] },
    'SESSIONS': { label: 'Sesiones', color: 'bg-indigo-100 text-indigo-700', actions: ['USER_LOGIN', 'USER_LOGOUT'] },
    'CENSUS': {
        label: 'Censo Diario',
        color: 'bg-emerald-100 text-emerald-700',
        actions: ['PATIENT_ADMITTED', 'PATIENT_DISCHARGED', 'PATIENT_TRANSFERRED', 'PATIENT_MODIFIED', 'PATIENT_CLEARED', 'DAILY_RECORD_CREATED', 'DAILY_RECORD_DELETED', 'BED_BLOCKED', 'BED_UNBLOCKED', 'EXTRA_BED_TOGGLED']
    },
    'CUDYR': { label: 'CUDYR', color: 'bg-amber-100 text-amber-700', actions: ['CUDYR_MODIFIED', 'VIEW_CUDYR'] },
    'HANDOFF_NURSE': { label: 'Entrega Enfermería', color: 'bg-purple-100 text-purple-700', actions: ['NURSE_HANDOFF_MODIFIED', 'VIEW_NURSING_HANDOFF', 'HANDOFF_NOVEDADES_MODIFIED'] },
    'HANDOFF_MEDICAL': { label: 'Entrega Médica', color: 'bg-sky-100 text-sky-700', actions: ['MEDICAL_HANDOFF_MODIFIED', 'VIEW_MEDICAL_HANDOFF', 'HANDOFF_NOVEDADES_MODIFIED', 'MEDICAL_HANDOFF_SIGNED'] },
    'MAINTENANCE': { label: '🛠️ Mantenimiento', color: 'bg-slate-200 text-slate-800', actions: [] },
    'EXPORT_KEYS': { label: 'Claves Excel', color: 'bg-rose-100 text-rose-700', actions: [] },
    'ACCESS_CONTROL': { label: '🔐 Acceso Externo', color: 'bg-blue-200 text-blue-800', actions: [] }
};

// ============================================================================
// Hook Implementation
// ============================================================================

export function useAuditData(): UseAuditDataReturn {
    const ITEMS_PER_PAGE = 50;

    // Core data state
    const [logs, setLogs] = useState<AuditLogEntry[]>([]);
    const [loading, setLoading] = useState(true);

    // Filter state
    const [searchTerm, setSearchTerm] = useState('');
    const [searchRut, setSearchRut] = useState('');
    const [filterAction, setFilterAction] = useState<AuditAction | 'ALL'>('ALL');
    const [startDate, setStartDate] = useState('');
    const [endDate, setEndDate] = useState('');
    const [activeSection, setActiveSection] = useState<AuditSection>('ALL');
    const [compactView, setCompactView] = useState(false);
    const [groupedView, setGroupedView] = useState(false);

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
            const data = await getAuditLogs(1000);
            setLogs(data);
        } catch (error) {
            console.error('Failed to fetch audit logs:', error);
        } finally {
            setLoading(false);
        }
    }, []);

    // Initial fetch
    useEffect(() => {
        fetchLogs();
    }, [fetchLogs]);

    // Process data whenever logs or filters change
    useEffect(() => {
        const sectionActions: Record<string, string[] | undefined> = {};
        Object.entries(AUDIT_SECTIONS).forEach(([key, config]) => {
            sectionActions[key] = config.actions;
        });

        const params: WorkerFilterParams = {
            searchTerm,
            searchRut,
            filterAction,
            startDate,
            endDate,
            activeSection,
            sectionActions
        };

        processData(logs, params, AUDIT_ACTION_LABELS, CRITICAL_ACTIONS);
    }, [logs, searchTerm, searchRut, filterAction, activeSection, startDate, endDate, processData]);

    // Row toggle handlers
    const toggleRow = useCallback((id: string) => {
        setExpandedRows(prev => {
            const newSet = new Set(prev);
            if (newSet.has(id)) newSet.delete(id);
            else newSet.add(id);
            return newSet;
        });
    }, []);

    const toggleMetadata = useCallback((id: string) => {
        setShowMetadata(prev => {
            const newSet = new Set(prev);
            if (newSet.has(id)) newSet.delete(id);
            else newSet.add(id);
            return newSet;
        });
    }, []);

    const { filteredLogs, displayLogs, stats: workerStats } = results;

    // Pagination
    const totalPages = Math.ceil(displayLogs.length / ITEMS_PER_PAGE);

    const paginatedLogs = useMemo(() => {
        const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
        return displayLogs.slice(startIndex, startIndex + ITEMS_PER_PAGE);
    }, [displayLogs, currentPage, ITEMS_PER_PAGE]);

    // Reset page when filters change
    useEffect(() => {
        setCurrentPage(1);
    }, [searchTerm, filterAction, activeSection, startDate, endDate]);

    // Use stats from worker
    const stats = (workerStats || {
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
        criticalActions: []
    }) as AuditStats;

    // Compose filters state object
    const filters: AuditFiltersState = {
        searchTerm,
        searchRut,
        filterAction,
        startDate,
        endDate,
        activeSection,
        compactView,
        groupedView
    };

    return {
        // Data
        logs,
        filteredLogs,
        displayLogs,
        paginatedLogs,
        stats,

        // Loading
        loading,
        isProcessing,

        // Filters
        filters,
        setSearchTerm,
        setSearchRut,
        setFilterAction,
        setStartDate,
        setEndDate,
        setActiveSection,
        setCompactView,
        setGroupedView,

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

        // Constants
        sections: AUDIT_SECTIONS,
        ITEMS_PER_PAGE
    };
}
