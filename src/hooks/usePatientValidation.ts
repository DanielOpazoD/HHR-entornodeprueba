/**
 * usePatientValidation Hook
 * Handles validation and formatting of patient data fields.
 * Extracted from useBedManagement for better separation of concerns.
 */

import { useCallback } from 'react';
import { PatientData, PatientFieldValue } from '@/types';
import { capitalizeWords } from '@/utils/stringUtils';
import { formatRut, isValidRut, isPassportFormat } from '@/utils/rutUtils';

// ============================================================================
// Types
// ============================================================================

export interface ValidationResult {
    valid: boolean;
    value: PatientFieldValue;
    error?: string;
}

export interface PatientValidationActions {
    /**
     * Process and validate a patient field value.
     * Applies formatting (capitalize names, format RUT) and validation rules.
     */
    processFieldValue: (
        field: keyof PatientData,
        value: PatientFieldValue
    ) => ValidationResult;

    /**
     * Validate admission date is not in the future.
     */
    validateAdmissionDate: (date: string) => ValidationResult;

    /**
     * Format and validate a RUT or Passport.
     */
    validateRut: (rut: string) => ValidationResult;

    /**
     * Capitalize patient name.
     */
    formatPatientName: (name: string) => string;
}

// ============================================================================
// Hook Implementation
// ============================================================================

export const usePatientValidation = (): PatientValidationActions => {

    /**
     * Capitalize patient name: each word starts with uppercase
     */
    const formatPatientName = useCallback((name: string): string => {
        if (!name || !name.trim()) return name;
        return capitalizeWords(name.trim());
    }, []);

    /**
     * Validate and format RUT or Passport
     */
    const validateRut = useCallback((rut: string): ValidationResult => {
        if (!rut || !rut.trim()) {
            return { valid: true, value: rut };
        }

        const trimmedRut = rut.trim();

        // If it looks like a passport, don't format
        if (isPassportFormat(trimmedRut)) {
            return { valid: true, value: trimmedRut };
        }

        // Try to format as RUT
        const formatted = formatRut(trimmedRut);

        if (isValidRut(formatted)) {
            return { valid: true, value: formatted };
        }

        // Return as-is if not a valid RUT format
        return { valid: true, value: trimmedRut };
    }, []);

    /**
     * Validate admission date is not in the future
     */
    const validateAdmissionDate = useCallback((date: string): ValidationResult => {
        if (!date) {
            return { valid: true, value: date };
        }

        const selectedDate = new Date(date);
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        if (selectedDate > today) {
            return {
                valid: false,
                value: date,
                error: 'La fecha de ingreso no puede ser futura'
            };
        }

        return { valid: true, value: date };
    }, []);

    /**
     * Process and validate any patient field value
     */
    const processFieldValue = useCallback((
        field: keyof PatientData,
        value: PatientFieldValue
    ): ValidationResult => {
        // Normalize patient name
        if (field === 'patientName' && typeof value === 'string') {
            return { valid: true, value: formatPatientName(value) };
        }

        // Format and validate RUT
        if (field === 'rut' && typeof value === 'string') {
            return validateRut(value);
        }

        // Validate admission date
        if (field === 'admissionDate' && typeof value === 'string') {
            return validateAdmissionDate(value);
        }

        // No special processing needed
        return { valid: true, value };
    }, [formatPatientName, validateRut, validateAdmissionDate]);

    return {
        processFieldValue,
        validateAdmissionDate,
        validateRut,
        formatPatientName
    };
};
