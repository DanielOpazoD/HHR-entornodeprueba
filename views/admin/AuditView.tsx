import React, { useState, useCallback } from 'react';
import { useAuditData } from '@/hooks/useAuditData';
import { generateAuditWorkbook } from '@/services/exporters/auditWorkbook';
import { saveAs } from 'file-saver';
import clsx from 'clsx';
import { AuditHeader } from './components/audit/AuditHeader';
import { AuditStatsDashboard } from './components/audit/AuditStatsDashboard';
import { AuditFilters } from './components/audit/AuditFilters';
import { AuditTable } from './components/audit/AuditTable';
import { AuditTimeline } from './components/audit/AuditTimeline';
import { PatientTraceability } from './components/audit/PatientTraceability';
import { ExportKeysPanel } from './components/audit/ExportKeysPanel';
import { DataMaintenancePanel } from './components/DataMaintenancePanel';
import { CensusAccessManager } from '@/components/admin/CensusAccessManager';
import { AUDIT_ACTION_LABELS } from '@/services/admin/auditService';
import { formatTimestamp } from './components/audit/auditUIUtils';

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

    // Export state
    const [exporting, setExporting] = useState(false);
    const [, setShowComplianceInfo] = useState(false);

    const handleExport = async () => {
        setExporting(true);
        try {
            const workbook = await generateAuditWorkbook(filteredLogs);
            const buffer = await workbook.xlsx.writeBuffer();
            const blob = new Blob([new Uint8Array(buffer)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
            saveAs(blob, `auditoria_hospital_${new Date().toISOString().split('T')[0]}.xlsx`);
        } catch (error) {
            console.error('Export failed:', error);
        } finally {
            setExporting(false);
        }
    };

    // PDF Export rendering logic
    const handlePdfExport = useCallback(() => {
        const printContent = `
            <!DOCTYPE html>
            <html>
                <head>
                    <meta charset="UTF-8">
                    <title>Reporte de Auditoría - Hospital de Hanga Roa</title>
                    <style>
                        @page {size: landscape; margin: 1.5cm; }
                        body {font-family: Arial, sans-serif; font-size: 10px; color: #333; }
                        h1 {font-size: 16px; margin-bottom: 5px; }
                        h2 {font-size: 12px; color: #666; margin-bottom: 20px; font-weight: normal; }
                        table {width: 100%; border-collapse: collapse; margin-top: 10px; }
                        th {background: #f1f5f9; padding: 8px; text-align: left; font-weight: bold; border-bottom: 2px solid #e2e8f0; font-size: 9px; text-transform: uppercase; }
                        td {padding: 6px 8px; border-bottom: 1px solid #e2e8f0; vertical-align: top; }
                        tr:nth-child(even) {background: #f8fafc; }
                        .critical {background: #fee2e2 !important; }
                        .header-info {display: flex; justify-content: space-between; margin-bottom: 15px; padding-bottom: 10px; border-bottom: 1px solid #e2e8f0; }
                        .stats {display: flex; gap: 30px; }
                        .stat {text-align: center; }
                        .stat-value {font-size: 18px; font-weight: bold; color: #4f46e5; }
                        .stat-label {font-size: 9px; color: #64748b; }
                        .footer {margin-top: 20px; padding-top: 10px; border-top: 1px solid #e2e8f0; font-size: 8px; color: #94a3b8; text-align: center; }
                    </style>
                </head>
                <body>
                    <div class="header-info">
                        <div>
                            <h1>📋 Reporte de Auditoría</h1>
                            <h2>Hospital de Hanga Roa - Sistema de Gestión Clínica</h2>
                        </div>
                        <div class="stats">
                            <div class="stat">
                                <div class="stat-value">${filteredLogs.length}</div>
                                <div class="stat-label">Registros</div>
                            </div>
                            <div class="stat">
                                <div class="stat-value">${stats.activeUserCount}</div>
                                <div class="stat-label">Usuarios</div>
                            </div>
                            <div class="stat">
                                <div class="stat-value">${stats.criticalCount}</div>
                                <div class="stat-label">Críticos</div>
                            </div>
                        </div>
                    </div>
                    <p><strong>Período:</strong> ${startDate || 'Inicio'} al ${endDate || 'Actual'} | <strong>Generado:</strong> ${new Date().toLocaleString('es-CL')}</p>
                    <table>
                        <thead>
                            <tr>
                                <th>Fecha/Hora</th>
                                <th>Operador</th>
                                <th>Acción</th>
                                <th>Resumen</th>
                                <th>Paciente</th>
                                <th>Cama</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${filteredLogs.slice(0, 200).map(log => {
            const isCritical = ['PATIENT_ADMITTED', 'PATIENT_DISCHARGED', 'PATIENT_TRANSFERRED', 'DAILY_RECORD_DELETED'].includes(log.action);
            const patientName = (log.details?.patientName as string) || '-';
            const bedId = (log.details?.bedId as string) || '-';
            return `<tr class="${isCritical ? 'critical' : ''}">
                                    <td>${formatTimestamp(log.timestamp)}</td>
                                    <td>${log.userDisplayName || (log.userId || '-').split('@')[0]}</td>
                                    <td>${AUDIT_ACTION_LABELS[log.action] || log.action}</td>
                                    <td>${log.summary || '-'}</td>
                                    <td>${patientName}</td>
                                    <td>${bedId}</td>
                                </tr>`;
        }).join('')}
                        </tbody>
                    </table>
                    ${filteredLogs.length > 200 ? '<p style="text-align: center; color: #94a3b8; margin-top: 10px;">Mostrando primeros 200 de ' + filteredLogs.length + ' registros</p>' : ''}
                    <div class="footer">
                        Este documento fue generado automáticamente por el Sistema de Auditoría del Hospital de Hanga Roa.<br>
                        Los registros de auditoría no pueden ser modificados ni eliminados para cumplir con la Ley 20.584.
                    </div>
                </body>
            </html>
        `;

        const printWindow = window.open('', '_blank');
        if (printWindow) {
            printWindow.document.write(printContent);
            printWindow.document.close();
            printWindow.onload = () => {
                printWindow.print();
            };
        }
    }, [filteredLogs, stats, startDate, endDate]);

    return (
        <div className="space-y-6 animate-fade-in pb-24 font-sans max-w-[1400px] mx-auto">
            {/* Header */}
            <AuditHeader
                onShowCompliance={() => setShowComplianceInfo(true)}
                onExport={handleExport}
                onRefresh={fetchLogs}
                isExporting={exporting}
                isLoading={loading}
                hasLogs={filteredLogs.length > 0}
            />

            {/* Dashboards */}
            <AuditStatsDashboard stats={stats} logs={logs} />

            {/* Navigation Tabs */}
            <div className="flex flex-wrap items-center gap-2 p-1.5 bg-slate-100/50 rounded-2xl w-fit">
                {(Object.keys(sections) as Array<keyof typeof sections>).map((key) => (
                    <button
                        key={key}
                        onClick={() => setActiveSection(key)}
                        className={clsx(
                            "px-4 py-2 rounded-xl font-bold text-xs transition-all flex items-center gap-2",
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
            {activeSection === 'MAINTENANCE' && <DataMaintenancePanel />}
            {activeSection === 'ACCESS_CONTROL' && <CensusAccessManager />}

            {/* Main Data Table */}
            {activeSection === 'ALL' && (
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
                    onExcelExport={handleExport}
                    isExporting={exporting}
                    currentPage={currentPage}
                    totalPages={totalPages}
                    onPageChange={setCurrentPage}
                    itemsPerPage={ITEMS_PER_PAGE}
                />
            )}
        </div>
    );
};
