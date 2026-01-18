/**
 * useAuditData Hook
 * 
 * Extracted from AuditView.tsx to manage audit log state, filtering, grouping, and pagination.
 * This improves separation of concerns and testability.
 */

import { useState, useEffect, useMemo, useCallback } from 'react';
import { getAuditLogs, AUDIT_ACTION_LABELS } from '../services/admin/auditService';
import { AuditAction, AuditLogEntry, GroupedAuditLogEntry } from '../types/audit';
import { useAuditStats } from './useAuditStats';
import { parseAuditTimestamp } from '../views/admin/components/audit/auditUIUtils';

// ============================================================================
// Types
// ============================================================================

export type AuditSection =
    | 'ALL'
    | 'TIMELINE'
    | 'SESSIONS'
    | 'CENSUS'
    | 'CUDYR'
    | 'HANDOFF_NURSE'
    | 'HANDOFF_MEDICAL'
    | 'EXPORT_KEYS'
    | 'TRACEABILITY'
    | 'MAINTENANCE'
    | 'ACCESS_CONTROL';

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
    stats: ReturnType<typeof useAuditStats>;

    // Loading state
    loading: boolean;

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

    // Filtered logs computation
    const filteredLogs = useMemo(() => {
        return logs.filter(log => {
            const logDate = parseAuditTimestamp(log.timestamp);
            const patientName = (log.details?.patientName as string) || '';
            const searchLower = searchTerm.toLowerCase();

            // 1. RUT Search - Highest Priority
            if (searchRut && searchRut.trim() !== '') {
                const rutClean = searchRut.replace(/[^0-9kK]/g, '').toLowerCase();
                const rawLogRut = (log.details?.rut as string || '').replace(/[^0-9kK]/g, '').toLowerCase();

                if (rawLogRut && rawLogRut === rutClean) {
                    // Match found
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
                patientName.toLowerCase().includes(searchLower);

            // 3. Action Filter
            const matchesFilter = filterAction === 'ALL' || log.action === filterAction;

            // 4. Section categorization
            const matchesSection = activeSection === 'ALL' ||
                AUDIT_SECTIONS[activeSection].actions?.includes(log.action);

            // 5. Date Filter
            const matchesDate = (!startDate || logDate >= new Date(startDate)) &&
                (!endDate || logDate <= new Date(endDate + 'T23:59:59'));

            return matchesSearch && matchesFilter && matchesDate && matchesSection;
        });
    }, [logs, searchTerm, searchRut, filterAction, activeSection, startDate, endDate]);

    // Grouped logs computation
    const displayLogs = useMemo(() => {
        if (!groupedView) return filteredLogs;

        const groups: Record<string, AuditLogEntry[]> = {};
        filteredLogs.forEach(log => {
            const dateStr = log.recordDate || parseAuditTimestamp(log.timestamp).toISOString().split('T')[0];
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

            return {
                ...first,
                id: `group-${key}`,
                timestamp: last.timestamp,
                summary: `${AUDIT_ACTION_LABELS[first.action] || first.action} (${group.length} registros)`,
                isGroup: true,
                childLogs: group
            } as GroupedAuditLogEntry;
        }).sort((a, b) => parseAuditTimestamp(b.timestamp).getTime() - parseAuditTimestamp(a.timestamp).getTime());
    }, [filteredLogs, groupedView]);

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

    // Statistics
    const stats = useAuditStats(logs);

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
