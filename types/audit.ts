/**
 * Audit Service Types
 * Defines the structure for audit logging entries.
 */

export type AuditAction =
    | 'PATIENT_ADMITTED'
    | 'PATIENT_DISCHARGED'
    | 'PATIENT_TRANSFERRED'
    | 'PATIENT_MODIFIED'
    | 'PATIENT_NOTE_UPDATED'
    | 'CLINICAL_EVENT_ADDED'
    | 'CLINICAL_EVENT_UPDATED'
    | 'CLINICAL_EVENT_DELETED'
    | 'PATIENT_CLEARED'
    | 'DAILY_RECORD_DELETED'
    | 'DAILY_RECORD_CREATED'
    | 'PATIENT_VIEWED'
    | 'VIEW_PATIENT'
    | 'NURSE_HANDOFF_MODIFIED'
    | 'MEDICAL_HANDOFF_MODIFIED'
    | 'HANDOFF_NOVEDADES_MODIFIED'
    | 'CUDYR_MODIFIED'
    | 'VIEW_CUDYR'
    | 'VIEW_NURSING_HANDOFF'
    | 'VIEW_MEDICAL_HANDOFF'
    | 'USER_LOGIN'
    | 'USER_LOGOUT'
    | 'BED_BLOCKED'
    | 'BED_UNBLOCKED'
    | 'EXTRA_BED_TOGGLED'
    | 'MEDICAL_HANDOFF_SIGNED'
    | 'DATA_IMPORTED'
    | 'DATA_EXPORTED'
    | 'SYSTEM_ERROR';

// Specific detail interfaces for different actions
export interface AuditDetailsPatient {
    patientName?: string;
    rut?: string;
    bedId?: string;
    pathology?: string;
    diagnosis?: string;
}

export type AuditValue = string | number | boolean | null | undefined | string[];

export interface AuditDetailsChange {
    field?: string;
    value?: AuditValue;
    oldValue?: AuditValue;
    newValue?: AuditValue;
    changes?: Record<string, { old: AuditValue; new: AuditValue }>;
}

export interface AuditDetailsHandoff {
    shift?: 'day' | 'night' | string;
    doctorName?: string;
    authorName?: string;
}

export interface AuditDetailsBed {
    bedId?: string;
    reason?: string;
    active?: boolean;
}

/**
 * Device change details for tracking invasive device modifications.
 */
export interface AuditDeviceChange {
    old: string | null | { installationDate?: string; notes?: string } | 'N/A';
    new: string | null | { installationDate?: string; notes?: string } | 'Eliminado';
}

/**
 * Generic field change tracking with old/new values.
 */
export interface AuditFieldChange {
    old: AuditValue;
    new: AuditValue;
}

/**
 * Map of device changes keyed by device name.
 */
export type AuditDeviceChangesMap = Record<string, AuditDeviceChange>;

/**
 * Map of generic field changes keyed by field name.
 */
export type AuditFieldChangesMap = Record<string, AuditFieldChange>;

export type AuditDetails = AuditDetailsPatient & AuditDetailsChange & AuditDetailsHandoff & AuditDetailsBed & Record<string, unknown>;

export interface AuditLogEntry {
    id: string;
    timestamp: string;          // ISO 8601

    // User identification
    userId: string;             // email del usuario (primary)
    userDisplayName?: string;   // Nombre visible (ej: "Daniel Opazo")
    userUid?: string;           // Firebase UID (técnico)
    ipAddress?: string;         // IP del cliente (si disponible)

    // Action details
    action: AuditAction;        // tipo de acción
    entityType: 'patient' | 'discharge' | 'transfer' | 'dailyRecord' | 'user' | 'system';
    entityId: string;           // bedId, recordId, etc.

    // Human-readable summary
    summary?: string;           // "Ingresó a Juan Pérez en cama R2"

    // Technical details
    details: AuditDetails;
    patientIdentifier?: string; // RUT enmascarado (ej: 12.345.***-K)
    recordDate?: string;        // fecha del registro afectado
    authors?: string;           // Identificación de autores reales
}

export interface GroupedAuditLogEntry extends AuditLogEntry {
    isGroup: true;
    childLogs: AuditLogEntry[];
}

/**
 * Mask a RUT for privacy (e.g., "12.345.678-9" -> "12.345.***-*")
 */
export const maskRut = (rut: string): string => {
    if (!rut || rut.length < 4) return '***';
    const parts = rut.split('-');
    if (parts.length === 2) {
        const body = parts[0];
        return body.slice(0, -3) + '***-*';
    }
    return rut.slice(0, -4) + '***';
};
