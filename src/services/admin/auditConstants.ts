import { AuditAction } from '@/types/audit';

export const CRITICAL_ACTIONS: AuditAction[] = [
    'PATIENT_ADMITTED',
    'PATIENT_DISCHARGED',
    'PATIENT_TRANSFERRED',
    'DAILY_RECORD_DELETED'
];

export const IMPORTANT_ACTIONS: AuditAction[] = [
    'PATIENT_MODIFIED',
    'CUDYR_MODIFIED',
    'NURSE_HANDOFF_MODIFIED',
    'MEDICAL_HANDOFF_MODIFIED',
    'HANDOFF_NOVEDADES_MODIFIED'
];

export const AUDIT_ACTION_LABELS: Record<string, string> = {
    'PATIENT_ADMITTED': 'Ingreso de Paciente',
    'PATIENT_DISCHARGED': 'Alta de Paciente',
    'PATIENT_TRANSFERRED': 'Traslado de Paciente',
    'PATIENT_MODIFIED': 'Modificación de Datos',
    'PATIENT_CLEARED': 'Limpieza de Cama',
    'DAILY_RECORD_DELETED': 'Eliminación de Registro',
    'DAILY_RECORD_CREATED': 'Creación de Registro',
    'VIEW_PATIENT': 'Visualización de Ficha',
    'PATIENT_VIEWED': 'Visualización de Ficha (Legacy)',
    'NURSE_HANDOFF_MODIFIED': 'Nota Enfermería (Entrega)',
    'MEDICAL_HANDOFF_MODIFIED': 'Nota Médica (Entrega)',
    'HANDOFF_NOVEDADES_MODIFIED': 'Cambio en Novedades',
    'CUDYR_MODIFIED': 'Evaluación CUDYR',
    'USER_LOGIN': 'Inicio de Sesión',
    'USER_LOGOUT': 'Cierre de Sesión',
    'BED_BLOCKED': 'Cama Bloqueada',
    'BED_UNBLOCKED': 'Cama Desbloqueada',
    'EXTRA_BED_TOGGLED': 'Cama Extra Toggled',
    'MEDICAL_HANDOFF_SIGNED': 'Firma Entrega Médica',
    'VIEW_CUDYR': 'Visualización CUDYR',
    'VIEW_NURSING_HANDOFF': 'Visualización Entrega Enfermería',
    'VIEW_MEDICAL_HANDOFF': 'Visualización Entrega Médica',
    'PATIENT_NOTE_UPDATED': 'Nota del Paciente Actualizada',
    'CLINICAL_EVENT_ADDED': 'Evento Clínico Agregado',
    'CLINICAL_EVENT_UPDATED': 'Evento Clínico Actualizado',
    'CLINICAL_EVENT_DELETED': 'Evento Clínico Eliminado',
    'DATA_IMPORTED': 'Importación de Datos',
    'DATA_EXPORTED': 'Exportación de Datos',
    'PATIENT_HARMONIZED': 'Armonización de Identidad',
    'SYSTEM_ERROR': 'Error del Sistema'
};
