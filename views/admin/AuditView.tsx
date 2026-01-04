import React, { useState, useCallback } from 'react';
import {
    ClipboardList, Search, RefreshCw, Clock, User, Users, TrendingUp,
    FileText, Filter, Download, ChevronDown, ChevronRight, Zap, Rows3, List,
    Calendar, AlertCircle, CheckCircle2, Trash2, LogIn, Eye, Activity, BarChart3,
    MapPin, LogOut, GitBranch, MessageSquare, Stethoscope, Info, X, Key,
    Box, Boxes, FileDown, LayoutGrid, History, BedDouble, Wrench, Upload
} from 'lucide-react';
import { AUDIT_ACTION_LABELS } from '../../services/admin/auditService';
import { useAuditData, AuditSection } from '../../hooks/useAuditData';
import { AuditAction, AuditLogEntry, GroupedAuditLogEntry } from '../../types/audit';
import { generateAuditWorkbook } from '../../services/exporters/auditWorkbook';
import { workbookToBuffer } from '../../services/exporters/excelUtils';
import { saveAs } from 'file-saver';
import clsx from 'clsx';
import { useAuditStats, formatDuration, getActionCriticality } from '../../hooks/useAuditStats';
import { PatientTraceability } from './components/audit/PatientTraceability';
import { ExportKeysPanel } from './components/audit/ExportKeysPanel';
import { AuditHeader } from './components/audit/AuditHeader';
import { AuditStatsDashboard } from './components/audit/AuditStatsDashboard';
import { AuditFilters } from './components/audit/AuditFilters';
import { DataMaintenancePanel } from './components/DataMaintenancePanel';
import { CensusAccessManager } from '../../components/admin/CensusAccessManager';

// Format ISO timestamp to readable format
const formatTimestamp = (iso: string): string => {
    const date = new Date(iso);
    return date.toLocaleString('es-CL', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
    });
};

// Action Icon Mapping
const actionIcons: Record<AuditAction, React.ReactNode> = {
    'PATIENT_ADMITTED': <CheckCircle2 size={14} />,
    'PATIENT_DISCHARGED': <LogOut size={14} />,
    'PATIENT_TRANSFERRED': <GitBranch size={14} />,
    'PATIENT_MODIFIED': <Activity size={14} />,
    'PATIENT_CLEARED': <Trash2 size={14} />,
    'DAILY_RECORD_DELETED': <Trash2 size={14} />,
    'DAILY_RECORD_CREATED': <FileText size={14} />,
    'PATIENT_VIEWED': <Eye size={14} />,
    'NURSE_HANDOFF_MODIFIED': <MessageSquare size={14} />,
    'MEDICAL_HANDOFF_MODIFIED': <Stethoscope size={14} />,
    'HANDOFF_NOVEDADES_MODIFIED': <AlertCircle size={14} />,
    'CUDYR_MODIFIED': <BarChart3 size={14} />,
    'USER_LOGIN': <LogIn size={14} />,
    'USER_LOGOUT': <LogOut size={14} />,
    'VIEW_CUDYR': <Eye size={14} />,
    'VIEW_NURSING_HANDOFF': <Eye size={14} />,
    'VIEW_MEDICAL_HANDOFF': <Eye size={14} />,
    'BED_BLOCKED': <X size={14} />,
    'BED_UNBLOCKED': <CheckCircle2 size={14} />,
    'EXTRA_BED_TOGGLED': <Zap size={14} />,
    'MEDICAL_HANDOFF_SIGNED': <User size={14} />,
    'DATA_IMPORTED': <Upload size={14} />,
    'DATA_EXPORTED': <Download size={14} />
};



// Action color mapping - Enhanced with semantic shades
const actionColors: Record<AuditAction, string> = {
    'PATIENT_ADMITTED': 'bg-emerald-50 text-emerald-700 border-emerald-100',
    'PATIENT_DISCHARGED': 'bg-blue-50 text-blue-700 border-blue-100',
    'PATIENT_TRANSFERRED': 'bg-indigo-50 text-indigo-700 border-indigo-100',
    'PATIENT_MODIFIED': 'bg-amber-50 text-amber-700 border-amber-100',
    'PATIENT_CLEARED': 'bg-slate-50 text-slate-700 border-slate-100',
    'DAILY_RECORD_DELETED': 'bg-rose-50 text-rose-700 border-rose-100',
    'DAILY_RECORD_CREATED': 'bg-cyan-50 text-cyan-700 border-cyan-100',
    'PATIENT_VIEWED': 'bg-teal-50 text-teal-700 border-teal-100',
    'NURSE_HANDOFF_MODIFIED': 'bg-purple-50 text-purple-700 border-purple-100',
    'MEDICAL_HANDOFF_MODIFIED': 'bg-sky-50 text-sky-700 border-sky-100',
    'HANDOFF_NOVEDADES_MODIFIED': 'bg-orange-50 text-orange-700 border-orange-100',
    'CUDYR_MODIFIED': 'bg-yellow-50 text-yellow-700 border-yellow-100',
    'USER_LOGIN': 'bg-violet-50 text-violet-700 border-violet-100',
    'USER_LOGOUT': 'bg-gray-50 text-gray-700 border-gray-100',
    'VIEW_CUDYR': 'bg-amber-50 text-amber-700 border-amber-100',
    'VIEW_NURSING_HANDOFF': 'bg-purple-50 text-purple-700 border-purple-100',
    'VIEW_MEDICAL_HANDOFF': 'bg-sky-50 text-sky-700 border-sky-100',
    'BED_BLOCKED': 'bg-rose-50 text-rose-700 border-rose-100',
    'BED_UNBLOCKED': 'bg-emerald-50 text-emerald-700 border-emerald-100',
    'EXTRA_BED_TOGGLED': 'bg-cyan-50 text-cyan-700 border-cyan-100',
    'MEDICAL_HANDOFF_SIGNED': 'bg-indigo-50 text-indigo-700 border-indigo-100',
    'DATA_IMPORTED': 'bg-indigo-50 text-indigo-700 border-indigo-100',
    'DATA_EXPORTED': 'bg-emerald-50 text-emerald-700 border-emerald-100'
};

const renderHumanDetails = (log: AuditLogEntry) => {
    const details = log.details || {};
    switch (log.action) {
        case 'PATIENT_ADMITTED':
            return `Se ingresó al paciente ${details.patientName || 'ANÓNIMO'} en la cama ${details.bedId || log.entityId}.`;
        case 'PATIENT_DISCHARGED':
            return `Se dio el alta a ${details.patientName || 'ANÓNIMO'} con estado "${details.status || 'Egreso'}".`;
        case 'PATIENT_TRANSFERRED':
            return `Se trasladó a ${details.patientName || 'ANÓNIMO'} hacia ${details.destination || 'otro centro'}.`;
        case 'PATIENT_MODIFIED':
            return `Se actualizaron los datos clínicos del paciente ${details.patientName || ''}.`;
        case 'PATIENT_CLEARED':
            return `Se liberó la cama ${details.bedId || log.entityId} (Paciente: ${details.patientName || 'N/A'}).`;
        case 'DAILY_RECORD_CREATED':
            return `Se creó el registro clínico para el día ${log.entityId}.`;
        case 'DAILY_RECORD_DELETED':
            return `Se eliminó permanentemente el registro clínico del ${log.entityId}.`;
        case 'CUDYR_MODIFIED':
            return `Se actualizó la evaluación CUDYR(${details.field || 'valor'}): ${details.value || '0'}.`;
        case 'NURSE_HANDOFF_MODIFIED':
            return `Modificación de nota de enfermería(${details.shift === 'day' ? 'Día' : 'Noche'}).`;
        case 'MEDICAL_HANDOFF_MODIFIED':
            return `Se editó la evolución médica del paciente.`;
        case 'HANDOFF_NOVEDADES_MODIFIED':
            return `Se actualizó la sección de novedades generales(${details.shift || 'turno'}).`;
        case 'VIEW_CUDYR':
            return `El usuario visualizó la planilla de categorización CUDYR.`;
        case 'BED_BLOCKED':
            return `Cama ${details.bedId || log.entityId} bloqueada${details.reason ? `: ${details.reason}` : ''}.`;
        case 'BED_UNBLOCKED':
            return `Cama ${details.bedId || log.entityId} desbloqueada.`;
        case 'EXTRA_BED_TOGGLED':
            return `Cama extra ${details.bedId || log.entityId} ${details.active ? 'activada' : 'desactivada'}.`;
        case 'MEDICAL_HANDOFF_SIGNED':
            return `Se registró la firma médica de ${(details.doctorName as string) || 'un profesional'}.`;
        case 'VIEW_NURSING_HANDOFF':
            return `Visualización de la entrega de turno de enfermería(${details.shift || 'turno'}).`;
        case 'VIEW_MEDICAL_HANDOFF':
            return `Visualización de la entrega de turno médica.`;
        case 'DATA_IMPORTED':
            return `Se importó un respaldo JSON(${details.recordCount || 0} registros).`;
        case 'DATA_EXPORTED':
            return `Se exportó la base de datos a JSON(${details.recordCount || 0} registros).`;
        default:
            return JSON.stringify(details).slice(0, 100) + '...';
    }
};

// Modular components imported from ./components/audit/

// Main Audit View Components

export const AuditView: React.FC = () => {
    // Use extracted hook for all audit data management
    const {
        logs,
        filteredLogs,
        displayLogs,
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
        currentPage,
        totalPages,
        setCurrentPage,
        expandedRows,
        toggleRow,
        showMetadata,
        toggleMetadata,
        fetchLogs,
        sections,
        ITEMS_PER_PAGE
    } = useAuditData();

    // Destructure filters for easier access
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

    // Export state (separate from data hook)
    const [exporting, setExporting] = useState(false);
    const [showComplianceInfo, setShowComplianceInfo] = useState(false);

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

    // PDF Export using browser print
    const handlePdfExport = useCallback(() => {
        const printContent = `
    < !DOCTYPE html >
        <html>
            <head>
                <meta charset="UTF-8">
                    <title>Reporte de Auditoría - Hospital de Hanga Roa</title>
                    <style>
                        @page {size: landscape; margin: 1.5cm; }
                        body {font - family: Arial, sans-serif; font-size: 10px; color: #333; }
                        h1 {font - size: 16px; margin-bottom: 5px; }
                        h2 {font - size: 12px; color: #666; margin-bottom: 20px; font-weight: normal; }
                        table {width: 100%; border-collapse: collapse; margin-top: 10px; }
                        th {background: #f1f5f9; padding: 8px; text-align: left; font-weight: bold; border-bottom: 2px solid #e2e8f0; font-size: 9px; text-transform: uppercase; }
                        td {padding: 6px 8px; border-bottom: 1px solid #e2e8f0; vertical-align: top; }
                        tr:nth-child(even) {background: #f8fafc; }
                        .critical {background: #fee2e2 !important; }
                        .header-info {display: flex; justify-content: space-between; margin-bottom: 15px; padding-bottom: 10px; border-bottom: 1px solid #e2e8f0; }
                        .stats {display: flex; gap: 30px; }
                        .stat {text - align: center; }
                        .stat-value {font - size: 18px; font-weight: bold; color: #4f46e5; }
                        .stat-label {font - size: 9px; color: #64748b; }
                        .footer {margin - top: 20px; padding-top: 10px; border-top: 1px solid #e2e8f0; font-size: 8px; color: #94a3b8; text-align: center; }
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
            {/* Header: Glassmorphism */}
            <AuditHeader
                onShowCompliance={() => setShowComplianceInfo(true)}
                onExport={handleExport}
                onRefresh={fetchLogs}
                isExporting={exporting}
                isLoading={loading}
                hasLogs={filteredLogs.length > 0}
            />

            {/* Stats Dashboard & Action Breakdown */}
            <AuditStatsDashboard stats={stats} logs={logs} />

            {/* Module Sections Navigation */}
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

            {/* Advanced Filters Panel */}
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

            {/* Export Keys Panel - Special Section */}
            {
                activeSection === 'EXPORT_KEYS' && (
                    <ExportKeysPanel />
                )
            }

            {/* Timeline Panel - Session visualization */}
            {
                activeSection === 'TIMELINE' && (
                    <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
                        <div className="flex items-center gap-3 mb-6">
                            <div className="w-10 h-10 rounded-xl bg-violet-100 flex items-center justify-center">
                                <Clock className="text-violet-600" size={20} />
                            </div>
                            <div>
                                <h3 className="text-lg font-bold text-slate-800">Timeline de Sesiones</h3>
                                <p className="text-xs text-slate-500">Actividad de usuarios por sesión</p>
                            </div>
                        </div>

                        {/* Group logs by user and date */}
                        {(() => {
                            // Get unique users from today's session logs
                            const sessionLogs = logs.filter(l => ['USER_LOGIN', 'USER_LOGOUT'].includes(l.action));
                            const userSessions: Record<string, AuditLogEntry[]> = {};

                            sessionLogs.forEach(log => {
                                const userId = log.userId || 'unknown';
                                if (!userSessions[userId]) userSessions[userId] = [];
                                userSessions[userId].push(log);
                            });

                            // Get all logs grouped by user for timeline
                            const userActivity: Record<string, AuditLogEntry[]> = {};
                            logs.forEach(log => {
                                const userId = log.userId || 'unknown';
                                if (userId.includes('anonymous')) return;
                                if (!userActivity[userId]) userActivity[userId] = [];
                                userActivity[userId].push(log);
                            });

                            return (
                                <div className="space-y-6">
                                    {Object.entries(userActivity)
                                        .filter(([userId]) => !userId.includes('anonymous'))
                                        .sort((a, b) => {
                                            const lastA = new Date(a[1][0]?.timestamp || 0).getTime();
                                            const lastB = new Date(b[1][0]?.timestamp || 0).getTime();
                                            return lastB - lastA;
                                        })
                                        .slice(0, 5)
                                        .map(([userId, userLogs]) => {
                                            const loginEvent = userLogs.find(l => l.action === 'USER_LOGIN');
                                            const logoutEvent = userLogs.find(l => l.action === 'USER_LOGOUT');
                                            const sortedLogs = [...userLogs].sort((a, b) =>
                                                new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
                                            );

                                            return (
                                                <div key={userId} className="border border-slate-100 rounded-xl p-4">
                                                    {/* User Header */}
                                                    <div className="flex items-center justify-between mb-4 pb-3 border-b border-slate-100">
                                                        <div className="flex items-center gap-3">
                                                            <div className="w-8 h-8 rounded-lg bg-violet-100 flex items-center justify-center text-sm font-bold text-violet-700">
                                                                {userId.charAt(0).toUpperCase()}
                                                            </div>
                                                            <div>
                                                                <p className="text-sm font-bold text-slate-700">{userId.split('@')[0]}</p>
                                                                <p className="text-[10px] text-slate-400">{userId}</p>
                                                            </div>
                                                        </div>
                                                        <div className="text-right">
                                                            <p className="text-xs font-bold text-slate-600">{userLogs.length} acciones</p>
                                                            {loginEvent?.ipAddress && (
                                                                <p className="text-[10px] text-slate-400 font-mono">IP: {loginEvent.ipAddress}</p>
                                                            )}
                                                        </div>
                                                    </div>

                                                    {/* Timeline */}
                                                    <div className="relative pl-6">
                                                        <div className="absolute left-2 top-0 bottom-0 w-0.5 bg-slate-200" />
                                                        {sortedLogs.slice(0, 10).map((log, idx) => (
                                                            <div key={log.id} className="relative mb-3 last:mb-0">
                                                                <div className={clsx(
                                                                    "absolute -left-4 w-3 h-3 rounded-full border-2 border-white shadow-sm",
                                                                    log.action === 'USER_LOGIN' ? "bg-emerald-500" :
                                                                        log.action === 'USER_LOGOUT' ? "bg-rose-500" :
                                                                            getActionCriticality(log.action) === 'critical' ? "bg-amber-500" :
                                                                                "bg-slate-300"
                                                                )} />
                                                                <div className="flex items-center justify-between">
                                                                    <div className="flex items-center gap-2">
                                                                        <span className="text-[10px] text-slate-400 font-mono w-12">
                                                                            {new Date(log.timestamp).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' })}
                                                                        </span>
                                                                        <span className={clsx(
                                                                            "text-xs font-medium px-2 py-0.5 rounded",
                                                                            actionColors[log.action]
                                                                        )}>
                                                                            {AUDIT_ACTION_LABELS[log.action]}
                                                                        </span>
                                                                    </div>
                                                                    <span className="text-[10px] text-slate-500 truncate max-w-[200px]">
                                                                        {log.summary || (log.details?.patientName as string) || ''}
                                                                    </span>
                                                                </div>
                                                            </div>
                                                        ))}
                                                        {sortedLogs.length > 10 && (
                                                            <p className="text-[10px] text-slate-400 pl-4">+{sortedLogs.length - 10} más acciones...</p>
                                                        )}
                                                    </div>
                                                </div>
                                            );
                                        })}
                                </div>
                            );
                        })()}
                    </div>
                )
            }

            {
                activeSection === 'TRACEABILITY' && (
                    <PatientTraceability
                        logs={logs}
                        searchRut={searchRut}
                        onSelectPatient={setSearchRut}
                    />
                )
            }

            {/* Maintenance Panel */}
            {
                activeSection === 'MAINTENANCE' && (
                    <DataMaintenancePanel />
                )
            }

            {/* Access Control Panel */}
            {
                activeSection === 'ACCESS_CONTROL' && (
                    <CensusAccessManager />
                )
            }

            {/* Logs Table: Modern Striped with Details */}
            {
                activeSection !== 'EXPORT_KEYS' && activeSection !== 'TIMELINE' && activeSection !== 'TRACEABILITY' && activeSection !== 'MAINTENANCE' && activeSection !== 'ACCESS_CONTROL' && (
                    <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
                        {/* Table Toolbar */}
                        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-100 bg-slate-50/30">
                            <div className="flex items-center gap-3">
                                <span className="text-xs font-medium text-slate-500">
                                    {filteredLogs.length} registros
                                </span>
                                {/* Compact View Toggle */}
                                <button
                                    onClick={() => setCompactView(!compactView)}
                                    className={clsx(
                                        "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-all",
                                        compactView
                                            ? "bg-indigo-50 text-indigo-700 border-indigo-200"
                                            : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"
                                    )}
                                    title={compactView ? "Vista normal" : "Vista compacta"}
                                >
                                    {compactView ? <List size={14} /> : <Rows3 size={14} />}
                                    {compactView ? "Compacto" : "Normal"}
                                </button>
                                {/* Grouped View Toggle (Area 6) */}
                                <button
                                    onClick={() => setGroupedView(!groupedView)}
                                    className={clsx(
                                        "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-all",
                                        groupedView
                                            ? "bg-amber-50 text-amber-700 border-amber-200"
                                            : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"
                                    )}
                                    title={groupedView ? "Vista individual" : "Agrupar por sección/día"}
                                >
                                    {groupedView ? <Box size={14} /> : <Boxes size={14} />}
                                    {groupedView ? "Agrupado" : "Individual"}
                                </button>
                            </div>
                            <div className="flex items-center gap-2">
                                {/* PDF Export Button */}
                                <button
                                    onClick={() => {
                                        // PDF will be implemented below
                                        handlePdfExport();
                                    }}
                                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-rose-50 text-rose-700 border border-rose-200 hover:bg-rose-100 transition-all"
                                >
                                    <FileDown size={14} />
                                    PDF
                                </button>
                                {/* Excel Export Button */}
                                <button
                                    onClick={handleExport}
                                    disabled={exporting}
                                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100 transition-all disabled:opacity-50"
                                >
                                    <Download size={14} />
                                    Excel
                                </button>
                            </div>
                        </div>
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead className="bg-slate-50/50 border-b border-slate-100">
                                    <tr className="text-slate-500 text-[10px] font-bold uppercase tracking-widest">
                                        <th className="px-6 py-4 text-left w-6"></th>
                                        <th className="px-4 py-4 text-left">Fecha/Hora</th>
                                        <th className="px-4 py-4 text-left">Operador</th>
                                        {!compactView && <th className="px-4 py-4 text-left">Acción</th>}
                                        <th className="px-4 py-4 text-left">Resumen</th>
                                        {!compactView && <th className="px-4 py-4 text-left">Paciente</th>}
                                        {!compactView && <th className="px-4 py-4 text-left">Cama</th>}
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-50">
                                    {loading ? (
                                        <tr>
                                            <td colSpan={7} className="px-4 py-20 text-center">
                                                <div className="flex flex-col items-center gap-3">
                                                    <RefreshCw size={40} className="animate-spin text-indigo-500 opacity-20" />
                                                    <p className="text-slate-400 font-medium animate-pulse">Sincronizando registros clínicos...</p>
                                                </div>
                                            </td>
                                        </tr>
                                    ) : filteredLogs.length === 0 ? (
                                        <tr>
                                            <td colSpan={7} className="px-4 py-20 text-center">
                                                <div className="flex flex-col items-center gap-3 opacity-30">
                                                    <Search size={48} className="text-slate-300" />
                                                    <p className="text-slate-500 font-bold">No se encontraron rastros para los filtros aplicados</p>
                                                </div>
                                            </td>
                                        </tr>
                                    ) : (
                                        paginatedLogs.map((log) => {
                                            // Extract data from details for organized columns
                                            // Only use bedId from details, don't fall back to entityId (which could be a date)
                                            const bedId = (log.details?.bedId as string) || '';
                                            const patientName = (log.details?.patientName as string) || '';

                                            return (
                                                <React.Fragment key={log.id}>
                                                    <tr
                                                        className={clsx(
                                                            "group hover:bg-slate-50/80 transition-all cursor-pointer",
                                                            expandedRows.has(log.id) ? "bg-indigo-50/20" : ""
                                                        )}
                                                        onClick={() => toggleRow(log.id)}
                                                    >
                                                        <td className="px-6 py-4">
                                                            {expandedRows.has(log.id)
                                                                ? <ChevronDown size={18} className="text-indigo-500" />
                                                                : <ChevronRight size={18} className="text-slate-300 group-hover:text-slate-500" />
                                                            }
                                                        </td>
                                                        {/* Fecha/Hora */}
                                                        <td className="px-4 py-4 whitespace-nowrap">
                                                            <div className="flex flex-col">
                                                                <span className="text-slate-900 font-bold">{formatTimestamp(log.timestamp).split(' ')[0]}</span>
                                                                <span className="text-[10px] text-slate-400 font-mono">{formatTimestamp(log.timestamp).split(' ')[1]}</span>
                                                            </div>
                                                        </td>
                                                        {/* Operador */}
                                                        <td className="px-4 py-4">
                                                            <div className="flex items-center gap-2">
                                                                <div className="w-7 h-7 rounded-lg bg-slate-100 flex items-center justify-center text-[10px] font-bold text-slate-500">
                                                                    {(log.userDisplayName || log.userId || 'U').charAt(0).toUpperCase()}
                                                                </div>
                                                                <div className="flex flex-col">
                                                                    <span className="text-xs font-semibold text-slate-700 truncate max-w-[140px]" title={log.userId || 'Usuario desconocido'}>
                                                                        {log.userDisplayName || (log.userId || 'anon@hhr.cl').split('@')[0]}
                                                                    </span>
                                                                    {log.ipAddress && (
                                                                        <span className="text-[9px] text-slate-400 font-mono">
                                                                            IP: {log.ipAddress}
                                                                        </span>
                                                                    )}
                                                                </div>
                                                            </div>
                                                        </td>
                                                        {/* Acción (badge) - hidden in compact */}
                                                        {!compactView && (
                                                            <td className="px-4 py-4">
                                                                <span className={clsx(
                                                                    "inline-flex items-center gap-1.5 text-[10px] font-bold px-2.5 py-1 rounded-lg border shadow-sm whitespace-nowrap",
                                                                    actionColors[log.action as AuditAction] || "bg-slate-50 text-slate-700 border-slate-100"
                                                                )}>
                                                                    {actionIcons[log.action as AuditAction]}
                                                                    {AUDIT_ACTION_LABELS[log.action as AuditAction]}
                                                                </span>
                                                            </td>
                                                        )}
                                                        {/* Resumen (HUMAN READABLE) */}
                                                        <td className="px-4 py-4">
                                                            <span
                                                                className={clsx(
                                                                    "text-xs text-slate-700 font-medium block truncate",
                                                                    compactView ? "max-w-[300px]" : "max-w-[180px]"
                                                                )}
                                                                title={log.summary || renderHumanDetails(log)}
                                                            >
                                                                {log.summary || renderHumanDetails(log)}
                                                            </span>
                                                        </td>
                                                        {/* Paciente - hidden in compact */}
                                                        {!compactView && (
                                                            <td className="px-4 py-4">
                                                                <span className="text-xs font-medium text-slate-600 truncate max-w-[150px]">
                                                                    {log.entityType === 'user' ? '-' : (patientName || '-')}
                                                                </span>
                                                            </td>
                                                        )}
                                                        {/* Cama - hidden in compact */}
                                                        {!compactView && (
                                                            <td className="px-4 py-4">
                                                                {log.entityType === 'user' || log.entityType === 'dailyRecord' ? (
                                                                    <span className="text-[10px] font-bold text-slate-300 uppercase tracking-tighter">
                                                                        {log.entityType === 'user' ? 'Sistema' : 'Registro'}
                                                                    </span>
                                                                ) : bedId ? (
                                                                    <div className="flex items-center gap-1.5 font-bold text-slate-700">
                                                                        <MapPin size={12} className="text-slate-400" />
                                                                        {bedId}
                                                                    </div>
                                                                ) : (
                                                                    <span className="text-slate-300">-</span>
                                                                )}
                                                            </td>
                                                        )}
                                                    </tr>
                                                    {/* Grouped Details (Area 6) */}
                                                    {(log as any as GroupedAuditLogEntry).isGroup && expandedRows.has(log.id) && (
                                                        <tr className="bg-amber-50/10">
                                                            <td colSpan={compactView ? 4 : 7} className="px-12 py-4 border-l-4 border-amber-500/30">
                                                                <div className="space-y-3">
                                                                    <h5 className="text-[10px] font-bold text-amber-600 uppercase tracking-widest flex items-center gap-1.5">
                                                                        <LayoutGrid size={12} />
                                                                        Detalle de acciones agrupadas
                                                                    </h5>
                                                                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                                                                        {(log as any as GroupedAuditLogEntry).childLogs.map((child: AuditLogEntry) => (
                                                                            <div key={child.id} className="bg-white p-3 rounded-lg border border-slate-200 shadow-sm flex flex-col gap-1 hover:border-amber-200 transition-colors">
                                                                                <div className="flex items-center justify-between">
                                                                                    <span className="text-[10px] font-bold text-slate-400 font-mono">
                                                                                        {formatTimestamp(child.timestamp).split(' ')[1]}
                                                                                    </span>
                                                                                    {(child.details?.bedId || child.entityType === 'patient') && (
                                                                                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 font-bold">
                                                                                            Cama {String(child.details?.bedId || child.entityId)}
                                                                                        </span>
                                                                                    )}
                                                                                </div>
                                                                                <p className="text-[11px] text-slate-600 line-clamp-2 leading-relaxed">
                                                                                    {child.summary || renderHumanDetails(child)}
                                                                                </p>
                                                                            </div>
                                                                        ))}
                                                                    </div>
                                                                </div>
                                                            </td>
                                                        </tr>
                                                    )}

                                                    {/* EXPANSIBLE DETAILS (Individual or first of group) */}
                                                    {!(log as any as GroupedAuditLogEntry).isGroup && expandedRows.has(log.id) && (
                                                        <tr className="bg-slate-50/50">
                                                            <td colSpan={compactView ? 4 : 7} className="px-12 py-6 border-l-4 border-indigo-500/30">
                                                                <div className="space-y-4">
                                                                    <div className="flex items-center justify-between">
                                                                        <h4 className="text-sm font-bold text-slate-800 flex items-center gap-2">
                                                                            <FileText size={16} className="text-indigo-500" />
                                                                            <div className="flex flex-col">
                                                                                <span>{renderHumanDetails(log)}</span>
                                                                                {log.authors && (
                                                                                    <span className="text-[10px] font-medium text-slate-400 italic">
                                                                                        Responsables: {log.authors}
                                                                                    </span>
                                                                                )}
                                                                            </div>
                                                                        </h4>
                                                                    </div>

                                                                    {/* Comparison / Diff View (NEW) */}
                                                                    {(log.action.includes('MODIFIED') || log.details?.changes) && (
                                                                        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
                                                                            <div className="bg-slate-50 px-4 py-2 border-b border-slate-200 flex items-center justify-between">
                                                                                <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Comparación de Cambios</span>
                                                                                <GitBranch size={12} className="text-slate-400" />
                                                                            </div>
                                                                            <div className="p-0 overflow-x-auto">
                                                                                <table className="w-full text-[10px]">
                                                                                    <thead>
                                                                                        <tr className="bg-slate-50/50 text-slate-400 border-b border-slate-100">
                                                                                            <th className="px-4 py-2 text-left font-bold">Campo</th>
                                                                                            <th className="px-4 py-2 text-left font-bold bg-rose-50/30 text-rose-700">Valor Anterior</th>
                                                                                            <th className="px-4 py-2 text-left font-bold bg-emerald-50/30 text-emerald-700">Valor Nuevo</th>
                                                                                        </tr>
                                                                                    </thead>
                                                                                    <tbody className="divide-y divide-slate-100">
                                                                                        {(() => {
                                                                                            const details = log.details as any;
                                                                                            const changes = details.changes || {};
                                                                                            const rows = [];

                                                                                            // Direct changes object (prefered)
                                                                                            if (Object.keys(changes).length > 0) {
                                                                                                for (const field in changes) {
                                                                                                    rows.push({
                                                                                                        field,
                                                                                                        old: changes[field].old,
                                                                                                        new: changes[field].new
                                                                                                    });
                                                                                                }
                                                                                            }
                                                                                            // Legacy / simple old vs new
                                                                                            else if (details.oldData || details.newData) {
                                                                                                const oldData = details.oldData || {};
                                                                                                const newData = details.newData || {};
                                                                                                const allKeys = Array.from(new Set([...Object.keys(oldData), ...Object.keys(newData)]));

                                                                                                allKeys.forEach(key => {
                                                                                                    if (JSON.stringify(oldData[key]) !== JSON.stringify(newData[key])) {
                                                                                                        rows.push({
                                                                                                            field: key,
                                                                                                            old: oldData[key],
                                                                                                            new: newData[key]
                                                                                                        });
                                                                                                    }
                                                                                                });
                                                                                            }

                                                                                            if (rows.length === 0) {
                                                                                                return (
                                                                                                    <tr>
                                                                                                        <td colSpan={3} className="px-4 py-8 text-center text-slate-400 italic">
                                                                                                            No se detectaron cambios estructurales registrados en el log técnico.
                                                                                                        </td>
                                                                                                    </tr>
                                                                                                );
                                                                                            }

                                                                                            return rows.map((row, i) => (
                                                                                                <tr key={i} className="hover:bg-slate-50/50 transition-colors">
                                                                                                    <td className="px-4 py-2 font-bold text-slate-700 capitalize">{row.field}</td>
                                                                                                    <td className="px-4 py-2 text-rose-600 bg-rose-50/10 font-mono">
                                                                                                        {typeof row.old === 'object' ? JSON.stringify(row.old) : String(row.old || '-')}
                                                                                                    </td>
                                                                                                    <td className="px-4 py-2 text-emerald-600 bg-emerald-50/10 font-bold font-mono">
                                                                                                        {typeof row.new === 'object' ? JSON.stringify(row.new) : String(row.new || '-')}
                                                                                                    </td>
                                                                                                </tr>
                                                                                            ));
                                                                                        })()}
                                                                                    </tbody>
                                                                                </table>
                                                                            </div>
                                                                        </div>
                                                                    )}

                                                                    <div className="flex items-center justify-end">
                                                                        <button
                                                                            onClick={(e) => {
                                                                                e.stopPropagation();
                                                                                toggleMetadata(log.id);
                                                                            }}
                                                                            className="flex items-center gap-1.5 px-3 py-1 bg-white border border-slate-200 rounded-lg text-[10px] font-bold text-slate-500 hover:bg-slate-50 transition-colors shadow-sm"
                                                                        >
                                                                            <Activity size={12} />
                                                                            {showMetadata.has(log.id) ? 'Ocultar Metadata' : 'Ver Metadata Técnica'}
                                                                        </button>
                                                                    </div>

                                                                    {showMetadata.has(log.id) && (
                                                                        <div className="bg-slate-900 p-4 rounded-xl shadow-inner font-mono text-[10px] leading-relaxed overflow-x-auto text-sky-400">
                                                                            <div className="flex items-center gap-2 mb-3 border-b border-slate-800 pb-2">
                                                                                <AlertCircle size={12} />
                                                                                <span className="uppercase tracking-widest font-bold">Detalles Técnicos / Sistema</span>
                                                                            </div>
                                                                            <pre className="opacity-90">
                                                                                {JSON.stringify(log.details || {}, null, 2)}
                                                                            </pre>
                                                                        </div>
                                                                    )}

                                                                    <div className="flex gap-6 pt-2 flex-wrap">
                                                                        <div>
                                                                            <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">ID Registro</p>
                                                                            <p className="text-[10px] text-slate-400 font-mono mt-1">{log.id}</p>
                                                                        </div>
                                                                        {log.patientIdentifier && (
                                                                            <div>
                                                                                <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">RUT Paciente</p>
                                                                                <p className="text-[10px] text-slate-600 font-mono mt-1">{log.patientIdentifier}</p>
                                                                            </div>
                                                                        )}
                                                                        {log.ipAddress && (
                                                                            <div>
                                                                                <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">IP Usuario</p>
                                                                                <p className="text-[10px] text-slate-600 font-mono mt-1">{log.ipAddress}</p>
                                                                            </div>
                                                                        )}
                                                                        {log.userUid && (
                                                                            <div>
                                                                                <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">Firebase UID</p>
                                                                                <p className="text-[10px] text-slate-400 font-mono mt-1">{log.userUid}</p>
                                                                            </div>
                                                                        )}
                                                                    </div>
                                                                </div>
                                                            </td>
                                                        </tr>
                                                    )}
                                                </React.Fragment>
                                            );
                                        })
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )
            }


            {/* Pagination / Total info */}
            <div className="flex items-center justify-between text-slate-500 text-xs font-medium px-2 py-3 bg-slate-50 rounded-xl border border-slate-100">
                <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-indigo-500"></span>
                    Mostrando {paginatedLogs.length} de {filteredLogs.length} filtrados ({logs.length} totales)
                </div>

                {/* Pagination Controls */}
                {totalPages > 1 && (
                    <div className="flex items-center gap-3">
                        <button
                            onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                            disabled={currentPage === 1}
                            className="px-3 py-1.5 rounded-lg bg-white border border-slate-200 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed transition-all font-semibold"
                        >
                            ← Anterior
                        </button>
                        <span className="text-slate-700 font-bold">
                            Página {currentPage} de {totalPages}
                        </span>
                        <button
                            onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                            disabled={currentPage === totalPages}
                            className="px-3 py-1.5 rounded-lg bg-white border border-slate-200 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed transition-all font-semibold"
                        >
                            Siguiente →
                        </button>
                    </div>
                )}

                <div className="flex items-center gap-4 italic text-slate-400">
                    <AlertCircle size={14} />
                    Los registros de auditoría son de solo lectura y no pueden ser modificados.
                </div>
            </div>
            {/* Compliance Modal */}
            {
                showComplianceInfo && (
                    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fade-in">
                        <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full max-h-[80vh] overflow-hidden flex flex-col border border-slate-200">
                            <div className="p-6 border-b border-slate-100 flex items-center justify-between bg-white sticky top-0">
                                <div className="flex items-center gap-3">
                                    <div className="p-2 bg-indigo-50 rounded-lg">
                                        <Info className="text-indigo-600" size={20} />
                                    </div>
                                    <h3 className="text-lg font-bold text-slate-900">Enfoque de Auditoría y Cumplimiento MINSAL</h3>
                                </div>
                                <button
                                    onClick={() => setShowComplianceInfo(false)}
                                    className="p-2 hover:bg-slate-100 rounded-full text-slate-400 transition-colors"
                                >
                                    <X size={20} />
                                </button>
                            </div>
                            <div className="p-8 overflow-y-auto text-sm text-slate-600 leading-relaxed font-sans">
                                <div className="space-y-6">
                                    <section>
                                        <h4 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-3">Marco Legal</h4>
                                        <p>El sistema se alinea con la <strong>Ley 20.584</strong> y la Norma Técnica de Ficha Clínica Electrónica, asegurando trazabilidad total e integridad de los datos.</p>
                                    </section>

                                    <section>
                                        <h4 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-3">Trazabilidad de Visualización</h4>
                                        <p>Para cumplir con las exigencias de confianza clínica, el sistema registra obligatoriamente el acceso a:</p>
                                        <ul className="list-disc ml-5 mt-2 space-y-1 text-slate-500">
                                            <li>Entrega de Turno Médica (Evoluciones y Diagnósticos).</li>
                                            <li>Entrega de Turno Enfermería (Notas de Cuidados).</li>
                                            <li>Evaluación CUDYR (Categorización de riesgo).</li>
                                        </ul>
                                    </section>

                                    <section>
                                        <h4 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-3">Protección de Datos</h4>
                                        <p>Cada registro captura el correo electrónico del usuario, marcas de tiempo inmutables y metadata de contexto técnico para asegurar la validez legal del rastro ante procesos médico-legales o acreditaciones.</p>
                                    </section>

                                    <div className="p-4 bg-emerald-50 rounded-xl border border-emerald-100 flex items-start gap-3 mt-4">
                                        <CheckCircle2 className="text-emerald-500 mt-0.5" size={16} />
                                        <div>
                                            <p className="text-xs font-bold text-emerald-800">Estado de los Registros</p>
                                            <p className="text-[11px] text-emerald-600 mt-1">Los datos aquí mostrados son de solo lectura y están protegidos contra cualquier intento de modificación o borrado accidental.</p>
                                        </div>
                                    </div>
                                </div>
                            </div>
                            <div className="p-4 bg-slate-50 border-t border-slate-100 text-center">
                                <button
                                    onClick={() => setShowComplianceInfo(false)}
                                    className="px-6 py-2 bg-slate-900 text-white rounded-xl text-xs font-bold hover:bg-slate-800 transition-all"
                                >
                                    Entendido
                                </button>
                            </div>
                        </div>
                    </div>
                )
            }
        </div >
    );
};

