/**
 * Critical Fields Validator
 * Validates that occupied beds have required fields (Estado, Fecha de ingreso)
 * before allowing PDF backup to Firebase Storage.
 * 
 * @module services/validation/criticalFieldsValidator
 */

import { DailyRecord, PatientData, PatientStatus } from '@/types';
import { BEDS } from '@/constants';

// ============================================================================
// Types
// ============================================================================

export type CriticalField = 'status' | 'admissionDate';

export interface CriticalFieldIssue {
    bedId: string;
    bedName: string;
    patientName: string;
    missingFields: CriticalField[];
    isCrib: boolean;
}

export interface CriticalFieldsValidationResult {
    isValid: boolean;
    issues: CriticalFieldIssue[];
    issueCount: number;
}

// ============================================================================
// Validation Logic
// ============================================================================

/**
 * Check if a patient has all critical fields filled
 */
const getMissingCriticalFields = (patient: PatientData): CriticalField[] => {
    const missing: CriticalField[] = [];

    // Status: must not be empty (check as string since it could be empty string from form)
    const statusValue = patient.status as string;
    if (!statusValue || statusValue === '' || statusValue === PatientStatus.EMPTY) {
        missing.push('status');
    }

    // Admission Date: must have at least the date (YYYY-MM-DD format)
    if (!patient.admissionDate || patient.admissionDate.trim() === '') {
        missing.push('admissionDate');
    }

    return missing;
};

/**
 * Validates all occupied beds for critical fields
 * Only checks beds with patients (patientName not empty, not blocked)
 * 
 * @param record - The daily record to validate
 * @returns Validation result with issues list
 */
export const validateCriticalFields = (record: DailyRecord): CriticalFieldsValidationResult => {
    const issues: CriticalFieldIssue[] = [];
    const activeExtras = record.activeExtraBeds || [];
    const visibleBeds = BEDS.filter(b => !b.isExtra || activeExtras.includes(b.id));

    visibleBeds.forEach(bed => {
        const patient = record.beds[bed.id];
        if (!patient) return;

        // Check main patient (only if occupied)
        if (patient.patientName && patient.patientName.trim() !== '' && !patient.isBlocked) {
            const missing = getMissingCriticalFields(patient);
            if (missing.length > 0) {
                issues.push({
                    bedId: bed.id,
                    bedName: bed.name,
                    patientName: patient.patientName,
                    missingFields: missing,
                    isCrib: false
                });
            }
        }

        // Check clinical crib (nested patient)
        if (patient.clinicalCrib?.patientName && patient.clinicalCrib.patientName.trim() !== '') {
            const missing = getMissingCriticalFields(patient.clinicalCrib);
            if (missing.length > 0) {
                issues.push({
                    bedId: `${bed.id}-crib`,
                    bedName: `${bed.name} (Cuna Clínica)`,
                    patientName: patient.clinicalCrib.patientName,
                    missingFields: missing,
                    isCrib: true
                });
            }
        }
    });

    return {
        isValid: issues.length === 0,
        issues,
        issueCount: issues.length
    };
};

/**
 * Get a human-readable description of missing fields
 */
export const getMissingFieldsLabel = (fields: CriticalField[]): string => {
    const labels: Record<CriticalField, string> = {
        status: 'Estado',
        admissionDate: 'Fecha de ingreso'
    };

    return fields.map(f => labels[f]).join(', ');
};

/**
 * Check if a specific bed has critical field issues
 */
export const hasCriticalIssues = (
    record: DailyRecord,
    bedId: string,
    isCrib: boolean = false
): CriticalField[] => {
    const bed = BEDS.find(b => b.id === bedId);
    if (!bed) return [];

    const patient = record.beds[bedId];
    if (!patient) return [];

    if (isCrib) {
        if (patient.clinicalCrib?.patientName && patient.clinicalCrib.patientName.trim() !== '') {
            return getMissingCriticalFields(patient.clinicalCrib);
        }
    } else {
        if (patient.patientName && patient.patientName.trim() !== '' && !patient.isBlocked) {
            return getMissingCriticalFields(patient);
        }
    }

    return [];
};
