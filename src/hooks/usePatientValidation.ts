import type { PatientData } from '@/types/domain/patient';

/**
 * usePatientValidation Hook
 * Handles validation and formatting of patient data fields.
 * Extracted from useBedManagement for better separation of concerns.
 */

import { useCallback, useMemo } from 'react';

import { PatientFieldValue } from '@/types/valueTypes';
import { isFutureDate } from '@/utils/dateCoreUtils';
import { capitalizeWords } from '@/utils/stringUtils';
import { formatRut, hasNonRutLetter, isValidRut } from '@/utils/rutUtils';

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
    value: PatientFieldValue,
    context?: Pick<PatientData, 'documentType'>
  ) => ValidationResult;

  /**
   * Validate admission date is not in the future.
   */
  validateAdmissionDate: (date: string) => ValidationResult;

  /**
   * Format and validate a RUT or Passport.
   */
  validateRut: (rut: string, documentType?: PatientData['documentType']) => ValidationResult;

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
  const validateRut = useCallback(
    (rut: string, documentType?: PatientData['documentType']): ValidationResult => {
      if (!rut || !rut.trim()) {
        return { valid: true, value: rut };
      }

      const trimmedRut = rut.trim();

      // ID-01: A passport is never converted to a Chilean RUT (even when its digits pass mod-11).
      if (documentType === 'Pasaporte' || hasNonRutLetter(trimmedRut)) {
        return { valid: true, value: trimmedRut };
      }

      // Try to format as RUT
      const formatted = formatRut(trimmedRut);

      if (isValidRut(formatted)) {
        return { valid: true, value: formatted };
      }

      // Return as-is if not a valid RUT format
      return { valid: true, value: trimmedRut };
    },
    []
  );

  /**
   * Validate admission date is not in the future
   */
  const validateAdmissionDate = useCallback((date: string): ValidationResult => {
    if (!date) {
      return { valid: true, value: date };
    }

    if (isFutureDate(date)) {
      return {
        valid: false,
        value: date,
        error: 'La fecha de ingreso no puede ser futura',
      };
    }

    return { valid: true, value: date };
  }, []);

  /**
   * Process and validate any patient field value
   */
  const processFieldValue = useCallback(
    (
      field: keyof PatientData,
      value: PatientFieldValue,
      context?: Pick<PatientData, 'documentType'>
    ): ValidationResult => {
      // Normalize patient name (legacy + split fields)
      if (
        (field === 'patientName' ||
          field === 'firstName' ||
          field === 'lastName' ||
          field === 'secondLastName') &&
        typeof value === 'string'
      ) {
        return { valid: true, value: formatPatientName(value) };
      }

      // Format and validate RUT
      if (field === 'rut' && typeof value === 'string') {
        return validateRut(value, context?.documentType);
      }

      // Validate admission date
      if (field === 'admissionDate' && typeof value === 'string') {
        return validateAdmissionDate(value);
      }

      // No special processing needed
      return { valid: true, value };
    },
    [formatPatientName, validateRut, validateAdmissionDate]
  );

  return useMemo(
    () => ({ processFieldValue, validateAdmissionDate, validateRut, formatPatientName }),
    [processFieldValue, validateAdmissionDate, validateRut, formatPatientName]
  );
};
