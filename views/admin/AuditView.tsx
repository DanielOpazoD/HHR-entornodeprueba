import React, { useState } from 'react';
import { useAuditData } from '@/hooks/useAuditData';
import { executeConsolidation, previewConsolidation } from '@/services/admin/auditConsolidationService';
import clsx from 'clsx';
import { AuditHeader } from './components/audit/AuditHeader';
import { AuditStatsDashboard } from './components/audit/AuditStatsDashboard';
import { AuditFilters } from './components/audit/AuditFilters';
import { AuditTable } from './components/audit/AuditTable';
import { AuditTimeline } from './components/audit/AuditTimeline';
import { PatientTraceability } from './components/audit/PatientTraceability';
import { ExportKeysPanel } from './components/audit/ExportKeysPanel';

import { ConsolidationManager } from './components/audit/ConsolidationManager';
import { CensusAccessManager } from '@/components/admin/CensusAccessManager';


import { isAdministratorEmail } from '@/constants/identities';
import { useNotification, useConfirmDialog } from '@/context/UIContext';
import { auth } from '@/firebaseConfig';
import { useAuditExport } from './hooks/useAuditExport';

export const AuditView: React.FC = () => {
    // Use extracted hook for all audit data management
    const {
        logs,
        filteredLogs,
        paginatedLogs,
        stats,
        loading,
        filters,
        setSearchTerm,
        setSearchRut,
        setFilterAction,
        setStartDate,
        setEndDate,
        setActiveSection,
        setCompactView,
        setGroupedView,
        expandedRows,
        toggleRow,
        fetchLogs,
        sections,
        currentPage,
        totalPages,
        setCurrentPage,
        ITEMS_PER_PAGE
    } = useAuditData();

    const {
        searchTerm,
        searchRut,
        filterAction,
        startDate,
        endDate,
        activeSection,
        compactView,
        groupedView
    } = filters;

    // Export and Consolidation state
    const [consolidating, setConsolidating] = useState(false);
    const [, setShowComplianceInfo] = useState(false);

    // Admin check
    const userEmail = auth.currentUser?.email;
    const isAdmin = isAdministratorEmail(userEmail);

    // Notifications
    const { success, error, info } = useNotification();
    const { confirm } = useConfirmDialog();

    // Export hook
    const {
        isExporting,
        handleExcelExport,
        handlePdfExport
    } = useAuditExport({
        filteredLogs,
        stats,
        startDate,
        endDate
    });

    // Handle consolidation of duplicate logs
    const handleConsolidate = async () => {
        try {
            // Preview first
            info('Analizando logs...', 'Buscando duplicados');
            const preview = await previewConsolidation(5);

            if (preview.duplicateGroups.length === 0) {
                success('No hay duplicados', 'Todos los logs están consolidados');
                return;
            }

            // Confirm with user
            const confirmed = await confirm({
                title: '🗂️ Consolidar Logs Duplicados',
                message: `Se encontraron ${preview.duplicateGroups.length} grupos con duplicados.\n\nEsto eliminará ${preview.estimatedDeletions} logs redundantes y mantendrá ${preview.duplicateGroups.length} logs consolidados con todos los cambios.\n\n¿Desea continuar?`,
                confirmText: 'Consolidar',
                cancelText: 'Cancelar',
                variant: 'warning'
            });

            if (!confirmed) return;

            setConsolidating(true);

            const result = await executeConsolidation(5, undefined, (msg) => {
                info(msg, 'Procesando...');
            });

            if (result.success) {
                success(
                    'Consolidación completada',
                    `${result.logsConsolidated} logs actualizados, ${result.logsDeleted} duplicados eliminados`
                );
                // Refresh logs
                fetchLogs();
            } else {
                error('Error en consolidación', result.errors.join(', '));
            }
        } catch (err) {
            console.error('Consolidation failed:', err);
            error('Error', 'No se pudo consolidar los logs');
        } finally {
            setConsolidating(false);
        }
    };

    return (
        <div className="space-y-6 animate-fade-in pb-24 font-sans max-w-[1400px] mx-auto">
            {/* Header */}
            <AuditHeader
                onShowCompliance={() => setShowComplianceInfo(true)}
                onExport={handleExcelExport}
                onRefresh={fetchLogs}
                onConsolidate={handleConsolidate}
                isExporting={isExporting}
                isLoading={loading}
                isConsolidating={consolidating}
                hasLogs={filteredLogs.length > 0}
                isAdmin={isAdmin}
            />

            {/* Dashboards */}
            <AuditStatsDashboard stats={stats} logs={logs} />

            {/* Navigation Tabs - Categorized */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                {/* Clinical Group */}
                <div className="flex flex-wrap items-center gap-2 p-1.5 bg-slate-100/50 rounded-2xl w-fit">
                    {(['ALL', 'TRACEABILITY', 'TIMELINE', 'CENSUS', 'CUDYR', 'HANDOFF_NURSE', 'HANDOFF_MEDICAL'] as Array<keyof typeof sections>).map((key) => (
                        <button
                            key={key}
                            onClick={() => setActiveSection(key)}
                            className={clsx(
                                "px-4 py-2 rounded-xl font-bold text-[11px] transition-all flex items-center gap-2",
                                activeSection === key
                                    ? "bg-white text-slate-900 shadow-sm border border-slate-200"
                                    : "text-slate-500 hover:text-slate-700 hover:bg-slate-100"
                            )}
                        >
                            <div className={clsx("w-2 h-2 rounded-full", sections[key].color.split(' ')[0].replace('bg-', 'bg-'))} />
                            {sections[key].label}
                        </button>
                    ))}
                </div>

                {/* System & Admin Group - Minimalist Glass Style */}
                <div className="flex flex-wrap items-center gap-1.5 p-1.5 bg-slate-200/30 backdrop-blur-sm rounded-2xl w-fit border border-slate-200/50 shadow-inner">
                    {(['SESSIONS', 'EXPORT_KEYS', 'MAINTENANCE', 'ACCESS_CONTROL'] as Array<keyof typeof sections>).map((key) => (
                        <button
                            key={key}
                            onClick={() => setActiveSection(key)}
                            className={clsx(
                                "px-4 py-2 rounded-xl font-bold text-[10px] uppercase tracking-wider transition-all flex items-center gap-2",
                                activeSection === key
                                    ? "bg-slate-900 text-white shadow-lg shadow-slate-200"
                                    : "text-slate-500 hover:text-slate-800 hover:bg-white/50"
                            )}
                        >
                            <div className={clsx(
                                "w-1.5 h-1.5 rounded-full",
                                activeSection === key ? "bg-white animate-pulse" : sections[key].color.split(' ')[0].replace('bg-', 'bg-')
                            )} />
                            {sections[key].label}
                        </button>
                    ))}
                </div>
            </div>

            {/* Filters */}
            <AuditFilters
                searchTerm={searchTerm}
                onSearchChange={setSearchTerm}
                searchRut={searchRut}
                onSearchRutChange={setSearchRut}
                filterAction={filterAction}
                onFilterActionChange={setFilterAction}
                startDate={startDate}
                onStartDateChange={setStartDate}
                endDate={endDate}
                onEndDateChange={setEndDate}
                onFocusTraceability={() => setActiveSection('TRACEABILITY')}
            />

            {/* Dynamic Panels */}
            {activeSection === 'EXPORT_KEYS' && <ExportKeysPanel />}
            {activeSection === 'TIMELINE' && <AuditTimeline logs={logs} />}
            {activeSection === 'TRACEABILITY' && (
                <PatientTraceability
                    logs={logs}
                    searchRut={searchRut}
                    onSelectPatient={setSearchRut}
                />
            )}
            {activeSection === 'MAINTENANCE' && (
                <div className="space-y-6">
                    <ConsolidationManager />
                </div>
            )}
            {activeSection === 'ACCESS_CONTROL' && <CensusAccessManager />}

            {/* Main Data Table */}
            {['ALL', 'SESSIONS', 'CENSUS', 'CUDYR', 'HANDOFF_NURSE', 'HANDOFF_MEDICAL'].includes(activeSection) && (
                <AuditTable
                    filteredLogs={filteredLogs}
                    paginatedLogs={paginatedLogs}
                    loading={loading}
                    compactView={compactView}
                    setCompactView={setCompactView}
                    groupedView={groupedView}
                    setGroupedView={setGroupedView}
                    expandedRows={expandedRows}
                    toggleRow={toggleRow}
                    onPdfExport={handlePdfExport}
                    onExcelExport={handleExcelExport}
                    isExporting={isExporting}
                    currentPage={currentPage}
                    totalPages={totalPages}
                    onPageChange={setCurrentPage}
                    itemsPerPage={ITEMS_PER_PAGE}
                />
            )}
        </div>
    );
};
