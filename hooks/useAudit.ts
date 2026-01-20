/**
 * useAudit Hook
 * Provides audit logging functions with user context.
 * Must be used within a component that has access to authenticated user.
 */

import React, { useCallback } from 'react';
import { logAuditEvent, getAuditLogs, AUDIT_ACTION_LABELS } from '../services/admin/auditService';
import { AuditAction, AuditLogEntry } from '../types/audit';

interface UseAuditReturn {
    // Logging functions
    logPatientAdmission: (bedId: string, patientName: string, rut: string, recordDate: string) => void;
    logPatientDischarge: (bedId: string, patientName: string, rut: string, status: string, recordDate: string) => void;
    logPatientTransfer: (bedId: string, patientName: string, rut: string, destination: string, recordDate: string) => void;
    logPatientCleared: (bedId: string, patientName: string, rut: string, recordDate: string) => void;
    logDailyRecordDeleted: (date: string) => void;
    logDailyRecordCreated: (date: string, copiedFrom?: string) => void;
    logPatientView: (bedId: string, patientName: string, rut: string, recordDate: string, authors?: string) => void;
    // Generic logger
    logEvent: (action: AuditAction, entityType: AuditLogEntry['entityType'], entityId: string, details: Record<string, unknown>, patientRut?: string, recordDate?: string, authors?: string) => void;
    // Smart logger (debounced)
    logDebouncedEvent: (action: AuditAction, entityType: AuditLogEntry['entityType'], entityId: string, details: Record<string, unknown>, patientRut?: string, recordDate?: string, authors?: string) => void;
    // Fetching
    fetchLogs: (limit?: number) => Promise<AuditLogEntry[]>;
    // Labels
    getActionLabel: (action: AuditAction) => string;
}

export const useAudit = (userId: string): UseAuditReturn => {
    // Store timers for debounced events (key: action-entityId)
    // We use 'any' for timer to avoid NodeJS vs Browser type conflicts
    const timersRef = React.useRef<Record<string, {
        timer: number,
        details: Record<string, unknown>,
        rut?: string,
        date?: string,
        authors?: string
    }>>({});

    const logEvent = useCallback((
        action: AuditAction,
        entityType: AuditLogEntry['entityType'],
        entityId: string,
        details: Record<string, unknown>,
        patientRut?: string,
        recordDate?: string,
        authors?: string
    ) => {
        // Fire and forget - don't await
        logAuditEvent(userId, action, entityType, entityId, details, patientRut, recordDate, authors);
    }, [userId]);

    // Smart logger (debounced with merging)
    const logDebouncedEvent = useCallback((
        action: AuditAction,
        entityType: AuditLogEntry['entityType'],
        entityId: string,
        details: Record<string, unknown>,
        patientRut?: string,
        recordDate?: string,
        authors?: string,
        waitMs: number = 5 * 60 * 1000 // Default 5 mins
    ) => {
        const key = `${action}-${entityId}`;

        // Get existing pending entry
        const pending = timersRef.current[key];

        // Merge changes if they exist
        let mergedDetails = { ...details };
        if (pending && pending.details && details.changes) {
            const oldChanges = (pending.details.changes || {}) as Record<string, { old?: unknown; new?: unknown } | unknown>;
            const newChanges = (details.changes || {}) as Record<string, { old?: unknown; new?: unknown } | unknown>;

            // Merge logic: Preserve the FIRST 'old' value in the chain
            // but take the LAST 'new' value.
            const mergedChanges: Record<string, unknown> = { ...oldChanges };

            Object.keys(newChanges).forEach(field => {
                const oldVal = mergedChanges[field] as Record<string, unknown> | undefined;
                const newVal = newChanges[field] as Record<string, unknown> | undefined;

                if (oldVal && typeof oldVal === 'object' && 'old' in oldVal) {
                    // Field already exists in pending log, keep its 'old' value
                    mergedChanges[field] = {
                        old: oldVal.old,
                        new: newVal && typeof newVal === 'object' && 'new' in newVal ? (newVal as any).new : newChanges[field]
                    };
                } else {
                    // New field being modified
                    mergedChanges[field] = newChanges[field];
                }
            });

            mergedDetails = {
                ...pending.details,
                ...details,
                changes: mergedChanges
            };
        }

        // Clear existing timer (explicitly using window for browser environment)
        if (pending) {
            window.clearTimeout(pending.timer);
        }

        // Set a new timer
        const timer = window.setTimeout(() => {
            const entry = timersRef.current[key];
            if (entry) {
                logEvent(action, entityType, entityId, entry.details, entry.rut, entry.date, entry.authors);
                delete timersRef.current[key];
            }
        }, waitMs);

        // Store merged details and timer
        timersRef.current[key] = {
            timer,
            details: mergedDetails,
            rut: patientRut,
            date: recordDate,
            authors
        };
    }, [logEvent]);

    const logPatientAdmission = useCallback((bedId: string, patientName: string, rut: string, recordDate: string) => {
        logEvent('PATIENT_ADMITTED', 'patient', bedId, { patientName, bedId }, rut, recordDate);
    }, [logEvent]);

    const logPatientDischarge = useCallback((bedId: string, patientName: string, rut: string, status: string, recordDate: string) => {
        logEvent('PATIENT_DISCHARGED', 'discharge', bedId, { patientName, status, bedId }, rut, recordDate);
    }, [logEvent]);

    const logPatientTransfer = useCallback((bedId: string, patientName: string, rut: string, destination: string, recordDate: string) => {
        logEvent('PATIENT_TRANSFERRED', 'transfer', bedId, { patientName, destination, bedId }, rut, recordDate);
    }, [logEvent]);

    const logPatientCleared = useCallback((bedId: string, patientName: string, rut: string, recordDate: string) => {
        logEvent('PATIENT_CLEARED', 'patient', bedId, { patientName, bedId }, rut, recordDate);
    }, [logEvent]);

    const logDailyRecordDeleted = useCallback((date: string) => {
        logEvent('DAILY_RECORD_DELETED', 'dailyRecord', date, { date }, undefined, date);
    }, [logEvent]);

    const logDailyRecordCreated = useCallback((date: string, copiedFrom?: string) => {
        logEvent('DAILY_RECORD_CREATED', 'dailyRecord', date, { date, copiedFrom }, undefined, date);
    }, [logEvent]);

    const logPatientView = useCallback((bedId: string, patientName: string, rut: string, recordDate: string, authors?: string) => {
        logEvent('PATIENT_VIEWED', 'patient', bedId, { patientName, bedId }, rut, recordDate, authors);
    }, [logEvent]);

    const fetchLogs = useCallback(async (limit: number = 100): Promise<AuditLogEntry[]> => {
        return getAuditLogs(limit);
    }, []);

    const getActionLabel = useCallback((action: AuditAction): string => {
        return AUDIT_ACTION_LABELS[action] || action;
    }, []);

    return {
        logPatientAdmission,
        logPatientDischarge,
        logPatientTransfer,
        logPatientCleared,
        logDailyRecordDeleted,
        logDailyRecordCreated,
        logPatientView,
        logEvent,
        logDebouncedEvent,
        fetchLogs,
        getActionLabel
    };
};
