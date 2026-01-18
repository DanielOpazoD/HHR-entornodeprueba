import React from 'react';
import {
    CheckCircle2, LogOut, GitBranch, Activity, Trash2, FileText, Eye,
    MessageSquare, Stethoscope, AlertCircle, BarChart3, LogIn, X, Zap,
    User, Upload, Download
} from 'lucide-react';
import { AuditAction, AuditLogEntry } from '@/types/audit';
import { parseAuditTimestamp } from '../../../../services/admin/utils/auditUtils';

// Safe parser for audit timestamps is now imported from auditUtils.ts
export { parseAuditTimestamp };

// Format any timestamp-like value to readable format
export const formatTimestamp = (timestamp: any): string => {
    const date = parseAuditTimestamp(timestamp);
    if (date.getTime() === 0) return 'Fecha desconocida';

    return date.toLocaleString('es-CL', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
    });
};

// Action Icon Mapping
export const actionIcons: Record<AuditAction, React.ReactNode> = {
    'PATIENT_ADMITTED': React.createElement(CheckCircle2, { size: 14 }),
    'PATIENT_DISCHARGED': React.createElement(LogOut, { size: 14 }),
    'PATIENT_TRANSFERRED': React.createElement(GitBranch, { size: 14 }),
    'PATIENT_MODIFIED': React.createElement(Activity, { size: 14 }),
    'PATIENT_CLEARED': React.createElement(Trash2, { size: 14 }),
    'DAILY_RECORD_DELETED': React.createElement(Trash2, { size: 14 }),
    'DAILY_RECORD_CREATED': React.createElement(FileText, { size: 14 }),
    'PATIENT_VIEWED': React.createElement(Eye, { size: 14 }),
    'NURSE_HANDOFF_MODIFIED': React.createElement(MessageSquare, { size: 14 }),
    'MEDICAL_HANDOFF_MODIFIED': React.createElement(Stethoscope, { size: 14 }),
    'HANDOFF_NOVEDADES_MODIFIED': React.createElement(AlertCircle, { size: 14 }),
    'CUDYR_MODIFIED': React.createElement(BarChart3, { size: 14 }),
    'USER_LOGIN': React.createElement(LogIn, { size: 14 }),
    'USER_LOGOUT': React.createElement(LogOut, { size: 14 }),
    'VIEW_CUDYR': React.createElement(Eye, { size: 14 }),
    'VIEW_NURSING_HANDOFF': React.createElement(Eye, { size: 14 }),
    'VIEW_MEDICAL_HANDOFF': React.createElement(Eye, { size: 14 }),
    'BED_BLOCKED': React.createElement(X, { size: 14 }),
    'BED_UNBLOCKED': React.createElement(CheckCircle2, { size: 14 }),
    'EXTRA_BED_TOGGLED': React.createElement(Zap, { size: 14 }),
    'MEDICAL_HANDOFF_SIGNED': React.createElement(User, { size: 14 }),
    'DATA_IMPORTED': React.createElement(Upload, { size: 14 }),
    'DATA_EXPORTED': React.createElement(Download, { size: 14 }),
    'PATIENT_NOTE_UPDATED': React.createElement(FileText, { size: 14 }),
    'CLINICAL_EVENT_ADDED': React.createElement(Zap, { size: 14 }),
    'CLINICAL_EVENT_UPDATED': React.createElement(Activity, { size: 14 }),
    'CLINICAL_EVENT_DELETED': React.createElement(Trash2, { size: 14 }),
    'VIEW_PATIENT': React.createElement(Eye, { size: 14 }),
    'SYSTEM_ERROR': React.createElement(AlertCircle, { size: 14 })
};

// Action color mapping - Enhanced with semantic shades
export const actionColors: Record<AuditAction, string> = {
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
    'DATA_EXPORTED': 'bg-emerald-50 text-emerald-700 border-emerald-100',
    'PATIENT_NOTE_UPDATED': 'bg-blue-50 text-blue-700 border-blue-100',
    'CLINICAL_EVENT_ADDED': 'bg-teal-50 text-teal-700 border-teal-100',
    'CLINICAL_EVENT_UPDATED': 'bg-amber-50 text-amber-700 border-amber-100',
    'CLINICAL_EVENT_DELETED': 'bg-rose-50 text-rose-700 border-rose-100',
    'VIEW_PATIENT': 'bg-teal-50 text-teal-700 border-teal-100',
    'SYSTEM_ERROR': 'bg-red-50 text-red-700 border-red-100'
};

export const renderHumanDetails = (log: AuditLogEntry) => {
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
        case 'SYSTEM_ERROR':
            return `Error del sistema: ${details.message || 'Error no especificado'}.`;
        default:
            return typeof details === 'string' ? details : JSON.stringify(details).slice(0, 100) + '...';
    }
};
