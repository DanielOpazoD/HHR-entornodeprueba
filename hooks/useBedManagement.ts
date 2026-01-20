import { useCallback } from 'react';
import { DailyRecord, PatientData, CudyrScore, PatientFieldValue, DailyRecordPatch } from '../types';
import { usePatientValidation } from './usePatientValidation';
import { useBedOperations } from './useBedOperations';
import { useClinicalCrib } from './useClinicalCrib';
import { useBedAudit } from './useBedAudit';


/**
 * Interface defining the actions available for bed management.
 */
export interface BedManagementActions {
    /**
     * Updates a single field for a patient in a specific bed.
     * Includes validation and audit logging for admissions.
     */
    updatePatient: (bedId: string, field: keyof PatientData, value: PatientFieldValue) => void;

    /**
     * Updates multiple patient fields atomically.
     */
    updatePatientMultiple: (bedId: string, fields: Partial<PatientData>) => void;

    /**
     * Updates a specific field in the CUDYR score for a patient.
     */
    updateCudyr: (bedId: string, field: keyof CudyrScore, value: number) => void;

    /**
     * Manages clinical crib operations (create, remove, or update fields).
     */
    updateClinicalCrib: (bedId: string, field: keyof PatientData | 'create' | 'remove', value?: PatientFieldValue) => void;

    /**
     * Updates multiple clinical crib fields atomically.
     */
    updateClinicalCribMultiple: (bedId: string, fields: Partial<PatientData>) => void;

    /**
     * Updates a specific field in the CUDYR score for a clinical crib.
     */
    updateClinicalCribCudyr: (bedId: string, field: keyof CudyrScore, value: number) => void;

    /**
     * Clears patient data from a bed (Discharge/Cleanup).
     */
    clearPatient: (bedId: string) => void;

    /**
     * Clears all beds in the current record.
     */
    clearAllBeds: () => void;

    /**
     * Moves or copies a patient from one bed to another.
     */
    moveOrCopyPatient: (type: 'move' | 'copy', sourceBedId: string, targetBedId: string) => void;

    /**
     * Toggles the blocked status of a bed with an optional reason.
     */
    toggleBlockBed: (bedId: string, reason?: string) => void;
    updateBlockedReason: (bedId: string, reason: string) => void;

    /**
     * Toggles an extra bed visibility.
     */
    toggleExtraBed: (bedId: string) => void;
}

// ============================================================================
// Hook Implementation
// ============================================================================

/**
 * useBedManagement Hook
 * 
 * Orchestrates all bed-related operations including patient data updates,
 * CUDYR scoring, and physical bed management (blocking, moving).
 * 
 * @param record - The current DailyRecord (Source of truth for the UI)
 * @param saveAndUpdate - Function to save the entire record (Full write)
 * @param patchRecord - Function to perform partial updates (Atomic writes via dot-notation)
 *                      Uses Firestore updateDoc behavior: only specified fields are changed,
 *                      preventing data loss from concurrent edits on different beds.
 * @returns An object containing all bed management actions
 */
export const useBedManagement = (
    record: DailyRecord | null,
    saveAndUpdate: (updatedRecord: DailyRecord) => void,
    patchRecord: (partial: DailyRecordPatch) => Promise<void>
): BedManagementActions => {
    // ========================================================================
    // Compose Specialized Hooks
    // ========================================================================

    const validation = usePatientValidation();
    const bedOperations = useBedOperations(record, patchRecord);
    const cribActions = useClinicalCrib(record, saveAndUpdate, patchRecord);
    const bedAudit = useBedAudit(record);

    // ========================================================================
    // Patient Updates
    // ========================================================================

    const updatePatient = useCallback((
        bedId: string,
        field: keyof PatientData,
        value: PatientFieldValue
    ) => {
        if (!record) return;

        // Validate and process the field value
        const result = validation.processFieldValue(field, value);

        if (!result.valid) {
            console.warn(`Validation failed for ${field}:`, result.error);
            return;
        }

        const processedValue = result.value;
        const oldPatient = record.beds[bedId];

        const patches: Record<string, unknown> = {
            [`beds.${bedId}.${field}`]: processedValue
        };

        // Identity Change Detection:
        // Clear clinical data if the patient's identity (RUT or Name) changes significantly.
        // This prevents data leakage (e.g., patient A's diagnosis staying on Bed 1 after changing it to Patient B).
        const isIdentityChange = (field === 'rut' || field === 'patientName') &&
            processedValue &&
            processedValue !== oldPatient[field];

        if (isIdentityChange) {
            Object.assign(patches, {
                [`beds.${bedId}.cie10Code`]: undefined,
                [`beds.${bedId}.cie10Description`]: undefined,
                [`beds.${bedId}.pathology`]: '',
                [`beds.${bedId}.clinicalEvents`]: [],
                [`beds.${bedId}.cudyr`]: undefined,
                [`beds.${bedId}.deviceDetails`]: {},
                [`beds.${bedId}.devices`]: []
            });
        }

        // Audit Logging (Delegated to specialized hook)
        bedAudit.auditPatientChange(bedId, field, oldPatient, processedValue);

        // Send an atomic patch to the database.
        patchRecord(patches as DailyRecordPatch);
    }, [record, validation, patchRecord, bedAudit]);

    /**
     * Update multiple patient fields atomically
     */
    const updatePatientMultiple = useCallback((
        bedId: string,
        fields: Partial<PatientData>
    ) => {
        if (!record) return;

        const patches: Record<string, unknown> = {};

        for (const [key, value] of Object.entries(fields)) {
            const field = key as keyof PatientData;
            const result = validation.processFieldValue(field, value as PatientFieldValue);

            if (result.valid) {
                patches[`beds.${bedId}.${key}`] = result.value;
            }
        }

        if (Object.keys(patches).length > 0) {
            patchRecord(patches as DailyRecordPatch);
        }
    }, [record, validation, patchRecord]);

    // ========================================================================
    // CUDYR Updates
    // ========================================================================

    const updateCudyr = useCallback((
        bedId: string,
        field: keyof CudyrScore,
        value: number
    ) => {
        if (!record) return;

        // Audit Log (Delegated)
        bedAudit.auditCudyrChange(bedId, field, value);

        patchRecord({
            [`beds.${bedId}.cudyr.${field}`]: value
        } as DailyRecordPatch);
    }, [record, patchRecord, bedAudit]);

    // ========================================================================
    // Clinical Crib Wrapper (maintains backwards compatibility)
    // ========================================================================

    const updateClinicalCrib = useCallback((
        bedId: string,
        field: keyof PatientData | 'create' | 'remove',
        value?: PatientFieldValue
    ) => {
        if (field === 'create') {
            cribActions.createCrib(bedId);
        } else if (field === 'remove') {
            cribActions.removeCrib(bedId);
        } else {
            cribActions.updateCribField(bedId, field, value);
        }
    }, [cribActions]);

    const updateClinicalCribMultiple = useCallback((
        bedId: string,
        fields: Partial<PatientData>
    ) => {
        cribActions.updateCribMultiple(bedId, fields);
    }, [cribActions]);

    /**
     * Updates CUDYR score for a clinical crib.
     */
    const updateClinicalCribCudyr = useCallback((
        bedId: string,
        field: keyof CudyrScore,
        value: number
    ) => {
        if (!record) return;

        // Audit Log (Delegated)
        bedAudit.auditCribCudyrChange(bedId, field, value);

        patchRecord({
            [`beds.${bedId}.clinicalCrib.cudyr.${field}`]: value
        } as DailyRecordPatch);
    }, [record, patchRecord, bedAudit]);

    // ========================================================================
    // Return API (composing all hooks)
    // ========================================================================

    return {
        // Patient Updates
        updatePatient,
        updatePatientMultiple,
        updateCudyr,

        // Clinical Crib (delegated)
        updateClinicalCrib,
        updateClinicalCribMultiple,
        updateClinicalCribCudyr,

        // Bed Operations (delegated)
        clearPatient: bedOperations.clearPatient,
        clearAllBeds: bedOperations.clearAllBeds,
        moveOrCopyPatient: bedOperations.moveOrCopyPatient,
        toggleBlockBed: bedOperations.toggleBlockBed,
        updateBlockedReason: bedOperations.updateBlockedReason,
        toggleExtraBed: bedOperations.toggleExtraBed
    };
};

