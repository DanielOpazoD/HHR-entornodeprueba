/**
 * Audit utilities and constants
 * Extracted from AuditView.tsx for better maintainability
 */
import React from 'react';
import {
    CheckCircle2, LogOut, GitBranch, Activity, Trash2,
    FileText, Eye, MessageSquare, Stethoscope, AlertCircle,
    BarChart3, LogIn, X, Zap, User, Upload, Download
} from 'lucide-react';
import { AuditAction } from '@/types/audit';

/**
 * Format timestamp-like value to readable format (es-CL locale)
 */
export const formatAuditTimestamp = (timestamp: any): string => {
    if (!timestamp) return 'Fecha desconocida';

    let date: Date;

    // Handle Firebase Timestamp objects or direct Date objects
    if (typeof timestamp.toDate === 'function') {
        date = timestamp.toDate();
    } else if (timestamp.seconds !== undefined) {
        date = new Date(timestamp.seconds * 1000);
    } else if (timestamp instanceof Date) {
        date = timestamp;
    }
    // Handle ISO strings or numbers (ms)
    else {
        date = new Date(timestamp);
    }

    if (isNaN(date.getTime())) return 'Fecha inválida';

    return date.toLocaleString('es-CL', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
    });
};

/**
 * Action Icon Mapping - Maps each audit action to its corresponding icon
 */
export const actionIcons: Record<AuditAction, React.ReactNode> = {
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
    'VIEW_PATIENT': <Eye size={14} />,
    'PATIENT_NOTE_UPDATED': <MessageSquare size={14} />,
    'CLINICAL_EVENT_ADDED': <Activity size={14} />,
    'CLINICAL_EVENT_UPDATED': <Activity size={14} />,
    'CLINICAL_EVENT_DELETED': <Trash2 size={14} />,
    'BED_BLOCKED': <X size={14} />,
    'BED_UNBLOCKED': <CheckCircle2 size={14} />,
    'EXTRA_BED_TOGGLED': <Zap size={14} />,
    'MEDICAL_HANDOFF_SIGNED': <User size={14} />,
    'DATA_IMPORTED': <Upload size={14} />,
    'DATA_EXPORTED': <Download size={14} />,
    'SYSTEM_ERROR': <AlertCircle size={14} />
};

/**
 * Action color mapping - Semantic color classes for each audit action type
 */
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
    'VIEW_PATIENT': 'bg-teal-50 text-teal-700 border-teal-100',
    'PATIENT_NOTE_UPDATED': 'bg-indigo-50 text-indigo-700 border-indigo-100',
    'CLINICAL_EVENT_ADDED': 'bg-emerald-50 text-emerald-700 border-emerald-100',
    'CLINICAL_EVENT_UPDATED': 'bg-amber-50 text-amber-700 border-amber-100',
    'CLINICAL_EVENT_DELETED': 'bg-rose-50 text-rose-700 border-rose-100',
    'BED_BLOCKED': 'bg-rose-50 text-rose-700 border-rose-100',
    'BED_UNBLOCKED': 'bg-emerald-50 text-emerald-700 border-emerald-100',
    'EXTRA_BED_TOGGLED': 'bg-cyan-50 text-cyan-700 border-cyan-100',
    'MEDICAL_HANDOFF_SIGNED': 'bg-indigo-50 text-indigo-700 border-indigo-100',
    'DATA_IMPORTED': 'bg-indigo-50 text-indigo-700 border-indigo-100',
    'DATA_EXPORTED': 'bg-emerald-50 text-emerald-700 border-emerald-100',
    'SYSTEM_ERROR': 'bg-red-50 text-red-700 border-red-100'
};

/**
 * Section configuration for audit log filtering
 */
export const auditSections = {
    'ALL': { label: 'Todos', color: 'bg-slate-100 text-slate-600' },
    'SESSIONS': { label: 'Sesiones', color: 'bg-indigo-100 text-indigo-700', actions: ['USER_LOGIN', 'USER_LOGOUT'] },
    'CENSUS': { label: 'Censo Diario', color: 'bg-emerald-100 text-emerald-700', actions: ['PATIENT_ADMITTED', 'PATIENT_DISCHARGED', 'PATIENT_TRANSFERRED', 'PATIENT_MODIFIED', 'PATIENT_CLEARED', 'DAILY_RECORD_CREATED', 'DAILY_RECORD_DELETED'] },
    'CUDYR': { label: 'CUDYR', color: 'bg-amber-100 text-amber-700', actions: ['CUDYR_MODIFIED', 'VIEW_CUDYR'] },
    'HANDOFF_NURSE': { label: 'Entrega Enfermería', color: 'bg-purple-100 text-purple-700', actions: ['NURSE_HANDOFF_MODIFIED', 'VIEW_NURSING_HANDOFF'] },
    'HANDOFF_MEDICAL': { label: 'Entrega Médica', color: 'bg-sky-100 text-sky-700', actions: ['MEDICAL_HANDOFF_MODIFIED', 'VIEW_MEDICAL_HANDOFF', 'HANDOFF_NOVEDADES_MODIFIED'] },
    'EXPORT_KEYS': { label: '🔐 Claves', color: 'bg-rose-100 text-rose-700' }
} as const;

export type AuditSectionKey = keyof typeof auditSections;

/**
 * Pagination configuration
 */
export const ITEMS_PER_PAGE = 50;
