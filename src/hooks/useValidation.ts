import type { PatientData } from '@/types/domain/patient';

import { useCallback } from 'react';
import { DailyRecordSchema } from '@/schemas/zodSchemas';

import type { DailyRecord } from '@/application/shared/dailyRecordCoreContracts';
import {
  validateMovePatient,
  validatePatientDischarge,
} from '@/hooks/controllers/validationController';
import { createScopedLogger } from '@/services/utils/loggerScope';

const validationLogger = createScopedLogger('Validation');

/**
 * Hook to manage record and clinical validation.
 * Ensures data integrity before reaching storage.
 */
export const useValidation = () => {
  /**
   * Validates a full record against the Zod schema.
   */
  const validateRecordSchema = useCallback((record: DailyRecord) => {
    const result = DailyRecordSchema.safeParse(record);
    if (!result.success) {
      validationLogger.warn('Schema violation', result.error.issues);
      return { isValid: false, errors: result.error.issues };
    }
    return { isValid: true, errors: [] };
  }, []);

  /**
   * Custom clinical rule: Check if a bed movement is valid.
   */
  const canMovePatient = useCallback(
    (
      sourceBedId: string,
      targetBedId: string,
      record: DailyRecord | null
    ): { canMove: boolean; reason?: string } => {
      return validateMovePatient(targetBedId, record);
    },
    []
  );

  /**
   * Custom clinical rule: Check if patient data is complete enough for discharge.
   */
  const canDischargePatient = useCallback(
    (patient: PatientData): boolean => validatePatientDischarge(patient),
    []
  );

  return {
    validateRecordSchema,
    canMovePatient,
    canDischargePatient,
  };
};
