import { db } from '../infrastructure/db';
import { auth } from '../../firebaseConfig';
import { AuditLogEntry, AuditAction, maskRut } from '../../types/audit';
import {
    saveAuditLog,
    getAuditLogs as getIndexedDBAuditLogs,
    getAuditLogsForDate as getIndexedDBAuditLogsForDate
} from '../storage/indexedDBService';
import {
    getCurrentUserEmail,
    getCurrentUserDisplayName,
    getCurrentUserUid,
    getCachedIpAddress,
    fetchAndCacheIpAddress
} from './utils/auditUtils';
import { generateSummary } from './utils/auditSummaryGenerator';

// ============================================================================
// Audit View - Policies & Throttling
// ============================================================================

import { getActiveHospitalId } from '../../constants/firestorePaths';

const COLLECTION_NAME = () => `hospitals/${getActiveHospitalId()}/auditLogs`;

/**
 * Users excluded from VIEW auditing (to reduce unnecessary data storage).
 */
const EXCLUDED_VIEW_AUDIT_EMAILS: string[] = [
    'daniel.opazo@hospitalhangaroa.cl',
    'hospitalizados@hospitalhangaroa.cl'
];

const shouldExcludeFromViewAudit = (): boolean => {
    const email = getCurrentUserEmail();
    return EXCLUDED_VIEW_AUDIT_EMAILS.includes(email);
};

// ============================================================================
// View Throttling (15 minute window)
// ============================================================================

const VIEW_THROTTLE_KEY = 'hhr_audit_view_throttle';
const VIEW_THROTTLE_WINDOW_MS = 15 * 60 * 1000;

interface ViewThrottleState {
    [action: string]: string;
}

const getViewThrottleState = (): ViewThrottleState => {
    if (typeof sessionStorage === 'undefined') return {};
    try {
        const data = sessionStorage.getItem(VIEW_THROTTLE_KEY);
        return data ? JSON.parse(data) : {};
    } catch {
        return {};
    }
};

const updateViewThrottleState = (action: string): void => {
    if (typeof sessionStorage === 'undefined') return;
    const state = getViewThrottleState();
    state[action] = new Date().toISOString();
    sessionStorage.setItem(VIEW_THROTTLE_KEY, JSON.stringify(state));
};

const shouldLogViewAction = (action: AuditAction): boolean => {
    if (!action.startsWith('VIEW_')) return true;
    const state = getViewThrottleState();
    const lastLogged = state[action];
    if (!lastLogged) return true;
    const elapsed = Date.now() - new Date(lastLogged).getTime();
    return elapsed >= VIEW_THROTTLE_WINDOW_MS;
};

export const logThrottledViewEvent = async (
    action: AuditAction,
    entityId: string,
    details: Record<string, unknown>,
    recordDate?: string
): Promise<void> => {
    if (shouldExcludeFromViewAudit()) return;
    if (!shouldLogViewAction(action)) return;

    await logAuditEvent(
        getCurrentUserEmail(),
        action,
        'patient',
        entityId,
        details,
        undefined,
        recordDate
    );
};

// ============================================================================
// Core Logging
// ============================================================================

const generateAuditId = (): string => `audit_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

const storeLocally = async (entry: AuditLogEntry): Promise<void> => {
    try {
        await saveAuditLog(entry);
    } catch (error) {
        console.error('Failed to store audit log in IndexedDB:', error);
    }
};

const logAuditEventToFirestore = async (entry: AuditLogEntry): Promise<void> => {
    try {
        await db.setDoc(COLLECTION_NAME(), entry.id, entry);
    } catch (error) {
        console.error('Failed to save audit log to Firestore:', error);
    }
};

export const logAuditEvent = async (
    userId: string,
    action: AuditAction,
    entityType: AuditLogEntry['entityType'],
    entityId: string,
    details: Record<string, unknown>,
    patientRut?: string,
    recordDate?: string,
    authors?: string
): Promise<void> => {
    if (action.startsWith('VIEW_') && !shouldLogViewAction(action)) return;
    if (action.startsWith('VIEW_')) updateViewThrottleState(action);

    const entry: AuditLogEntry = {
        id: generateAuditId(),
        timestamp: new Date().toISOString(),
        userId,
        userDisplayName: getCurrentUserDisplayName(),
        userUid: getCurrentUserUid(),
        ipAddress: getCachedIpAddress(),
        action,
        entityType,
        entityId,
        summary: generateSummary(action, details, entityId),
        details: {
            ...details,
            _metadata: {
                userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : 'Server',
                platform: typeof navigator !== 'undefined' ? navigator.platform : 'Unknown'
            }
        },
        patientIdentifier: patientRut ? maskRut(patientRut) : undefined,
        recordDate,
        authors
    };

    storeLocally(entry);
    await logAuditEventToFirestore(entry);
};

// ============================================================================
// Data Retrieval
// ============================================================================

export const getAuditLogs = async (limitCount: number = 100): Promise<AuditLogEntry[]> => {
    try {
        return await db.getDocs<AuditLogEntry>(COLLECTION_NAME(), {
            orderBy: [{ field: 'timestamp', direction: 'desc' }],
            limit: limitCount
        });
    } catch (error) {
        console.error('Failed to fetch audit logs from Firestore:', error);
        return await getIndexedDBAuditLogs(limitCount);
    }
};

export const getAuditLogsForDate = async (date: string): Promise<AuditLogEntry[]> => {
    try {
        return await db.getDocs<AuditLogEntry>(COLLECTION_NAME(), {
            where: [{ field: 'recordDate', operator: '==', value: date }],
            orderBy: [{ field: 'timestamp', direction: 'desc' }]
        });
    } catch (error) {
        console.error('Failed to fetch audit logs for date:', error);
        return await getIndexedDBAuditLogsForDate(date);
    }
};

// ============================================================================
// UI Utils
// ============================================================================

export const AUDIT_ACTION_LABELS: Record<AuditAction, string> = {
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
    'SYSTEM_ERROR': 'Error del Sistema'
};


// ============================================================================
// Simple Logging Functions (auto-detect user)
// These can be called directly from hooks without passing userId
// ============================================================================

/**
 * Log patient admission (when patientName is set on empty bed)
 */
export const logPatientAdmission = (bedId: string, patientName: string, rut: string, pathology: string, recordDate: string): Promise<void> => {
    return logAuditEvent(getCurrentUserEmail(), 'PATIENT_ADMITTED', 'patient', bedId, { patientName, bedId, pathology, rut }, rut, recordDate);
};

/**
 * Log patient discharge
 */
export const logPatientDischarge = (bedId: string, patientName: string, rut: string, status: string, recordDate: string): Promise<void> => {
    return logAuditEvent(getCurrentUserEmail(), 'PATIENT_DISCHARGED', 'discharge', bedId, { patientName, status, bedId, rut }, rut, recordDate);
};

/**
 * Log patient transfer
 */
export const logPatientTransfer = (bedId: string, patientName: string, rut: string, destination: string, recordDate: string): Promise<void> => {
    return logAuditEvent(getCurrentUserEmail(), 'PATIENT_TRANSFERRED', 'transfer', bedId, { patientName, destination, bedId, rut }, rut, recordDate);
};

/**
 * Log patient data cleared from bed
 */
export const logPatientCleared = (bedId: string, patientName: string, rut: string, recordDate: string): Promise<void> => {
    return logAuditEvent(getCurrentUserEmail(), 'PATIENT_CLEARED', 'patient', bedId, { patientName, bedId }, rut, recordDate);
};

/**
 * Log daily record deletion
 */
export const logDailyRecordDeleted = (date: string): Promise<void> => {
    return logAuditEvent(getCurrentUserEmail(), 'DAILY_RECORD_DELETED', 'dailyRecord', date, { date }, undefined, date);
};

/**
 * Log daily record creation
 */
export const logDailyRecordCreated = (date: string, copiedFrom?: string): Promise<void> => {
    return logAuditEvent(getCurrentUserEmail(), 'DAILY_RECORD_CREATED', 'dailyRecord', date, { date, copiedFrom }, undefined, date);
};

/**
 * Log patient record view (for legal traceability)
 * Throttled to 1 log per 15 minutes to prevent storage bloat and sync loops.
 */
export const logPatientView = (bedId: string, patientName: string, rut: string, recordDate: string): Promise<void> => {
    // 1. Skip logging for excluded users (admin/nursing)
    if (shouldExcludeFromViewAudit()) {
        return Promise.resolve();
    }

    // 2. Use the standard throttled view mechanism
    return logThrottledViewEvent(
        'VIEW_PATIENT',
        bedId,
        { patientName, bedId, rut },
        recordDate
    );
};

// Internal helper for non-view throttling
const shouldLogThrottledAction = (action: AuditAction, entityId: string): boolean => {
    const stateKey = `hhr_audit_throttle_${action}_${entityId}`;
    if (typeof sessionStorage === 'undefined') return true;

    const lastLogged = sessionStorage.getItem(stateKey);
    if (!lastLogged) return true;

    const elapsed = Date.now() - new Date(lastLogged).getTime();
    return elapsed >= 5 * 60 * 1000; // 5 minute window for edits
};

const markActionAsLogged = (action: AuditAction, entityId: string): void => {
    const stateKey = `hhr_audit_throttle_${action}_${entityId}`;
    if (typeof sessionStorage !== 'undefined') {
        sessionStorage.setItem(stateKey, new Date().toISOString());
    }
};

/**
 * Log modification of nursing handoff note
 */
export const logNurseHandoffModified = (bedId: string, patientName: string, rut: string, shift: string, note: string, oldNote: string, recordDate: string): Promise<void> => {
    if (!shouldLogThrottledAction('NURSE_HANDOFF_MODIFIED', bedId)) {
        return Promise.resolve();
    }
    markActionAsLogged('NURSE_HANDOFF_MODIFIED', bedId);

    return logAuditEvent(getCurrentUserEmail(), 'NURSE_HANDOFF_MODIFIED', 'patient', bedId, {
        patientName,
        bedId,
        rut,
        shift,
        note,
        changes: {
            note: { old: oldNote, new: note }
        }
    }, rut, recordDate);
};

/**
 * Log modification of medical handoff note
 */
export const logMedicalHandoffModified = (bedId: string, patientName: string, rut: string, note: string, oldNote: string, recordDate: string): Promise<void> => {
    if (!shouldLogThrottledAction('MEDICAL_HANDOFF_MODIFIED', bedId)) {
        return Promise.resolve();
    }
    markActionAsLogged('MEDICAL_HANDOFF_MODIFIED', bedId);

    return logAuditEvent(getCurrentUserEmail(), 'MEDICAL_HANDOFF_MODIFIED', 'patient', bedId, {
        patientName,
        bedId,
        rut,
        note,
        changes: {
            note: { old: oldNote, new: note }
        }
    }, rut, recordDate);
};

/**
 * Log modification of general handoff novedades
 */
export const logHandoffNovedadesModified = (shift: string, content: string, oldContent: string, recordDate: string): Promise<void> => {
    return logAuditEvent(getCurrentUserEmail(), 'HANDOFF_NOVEDADES_MODIFIED', 'dailyRecord', recordDate, {
        shift,
        content,
        changes: {
            novedades: { old: oldContent, new: content }
        }
    }, undefined, recordDate);
};

/**
 * Log CUDYR score modification (throttled - only logs once per 15 min for same patient)
 * This prevents logging every individual field change.
 */
export const logCudyrModified = (bedId: string, patientName: string, rut: string, field: string, value: number, oldValue: number, recordDate: string): Promise<void> => {
    if (!shouldLogViewAction('CUDYR_MODIFIED' as AuditAction)) {
        return Promise.resolve();
    }

    return logAuditEvent(
        getCurrentUserEmail(),
        'CUDYR_MODIFIED',
        'patient',
        bedId,
        {
            patientName,
            bedId,
            lastField: field,
            lastValue: value,
            changes: {
                [field]: { old: oldValue, new: value }
            }
        },
        rut,
        recordDate
    );
};

/**
 * Log user login and store start time for duration calculation
 */
export const logUserLogin = async (email: string): Promise<void> => {
    if (typeof sessionStorage !== 'undefined') {
        sessionStorage.setItem('hhr_session_start', new Date().toISOString());
    }

    fetchAndCacheIpAddress().catch(() => { });

    return logAuditEvent(email, 'USER_LOGIN', 'user', email, { event: 'login' });
};

/**
 * Log user logout and calculate session duration
 */
export const logUserLogout = (email: string, reason: 'manual' | 'automatic' = 'manual'): Promise<void> => {
    let durationSec = 0;
    if (typeof sessionStorage !== 'undefined') {
        const start = sessionStorage.getItem('hhr_session_start');
        if (start) {
            durationSec = Math.floor((new Date().getTime() - new Date(start).getTime()) / 1000);
            sessionStorage.removeItem('hhr_session_start');
        }
    }

    return logAuditEvent(email, 'USER_LOGOUT', 'user', email, {
        event: 'logout',
        reason,
        durationSeconds: durationSec,
        durationFormatted: durationSec > 0 ? `${Math.floor(durationSec / 60)}m ${durationSec % 60}s` : 'Unknown'
    });
};

/**
 * Log system error (Centralized Error Handling)
 */
export const logSystemError = (
    message: string,
    severity: 'medium' | 'high' | 'critical',
    details: Record<string, unknown>
): Promise<void> => {
    const email = getCurrentUserEmail() || 'system';
    const errorId = `err_${Date.now()}`;

    return logAuditEvent(
        email,
        'SYSTEM_ERROR',
        'system',
        errorId,
        {
            message,
            severity,
            ...details
        }
    );
};

