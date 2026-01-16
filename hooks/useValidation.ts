import { useCallback } from 'react';
import { DailyRecordSchema } from '../schemas/zodSchemas';
import { PatientData, DailyRecord } from '../types';

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
            console.warn('[Validation] Schema violation:', result.error.issues);
            return { isValid: false, errors: result.error.issues };
        }
        return { isValid: true, errors: [] };
    }, []);

    /**
     * Custom clinical rule: Check if a bed movement is valid.
     */
    const canMovePatient = useCallback((
        sourceBedId: string,
        targetBedId: string,
        record: DailyRecord | null
    ): { canMove: boolean; reason?: string } => {
        if (!record) return { canMove: false, reason: 'No hay registro cargado' };

        const targetBed = record.beds[targetBedId];
        if (targetBed?.patientName?.trim()) {
            return { canMove: false, reason: 'La cama de destino ya está ocupada' };
        }

        if (targetBed?.isBlocked) {
            return { canMove: false, reason: 'La cama de destino está bloqueada' };
        }

        return { canMove: true };
    }, []);

    /**
     * Custom clinical rule: Check if patient data is complete enough for discharge.
     */
    const canDischargePatient = useCallback((patient: PatientData): boolean => {
        return !!(patient.patientName?.trim() && patient.admissionDate);
    }, []);

    return {
        validateRecordSchema,
        canMovePatient,
        canDischargePatient
    };
};
