import { useCallback, useRef, useEffect, useMemo } from 'react';
import { DailyRecord, PatientData, CudyrScore, PatientFieldValue, DailyRecordPatch } from '@/types';
import { usePatientValidation } from './usePatientValidation';
import { useBedAudit } from './useBedAudit';
import { BedAction, bedManagementReducer } from './useBedManagementReducer';
import { BEDS } from '@/constants';
import { getBedTypeForRecord } from '@/utils/bedTypeUtils';
import { BedType } from '@/types';


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

    /**
     * Toggles bed level of care (UTI/UCI)
     */
    toggleBedType: (bedId: string) => void;
}

// ============================================================================
// Hook Implementation
// ============================================================================

/**
 * useBedManagement Hook
 * 
 * Orchestrates all bed-related operations using a Redux-style reducer pattern.
 * This simplifies delegation and makes state transitions predictable.
 */
export const useBedManagement = (
    record: DailyRecord | null,
    saveAndUpdate: (updatedRecord: DailyRecord) => void, // Kept for legacy compat
    patchRecord: (partial: DailyRecordPatch) => Promise<void>
): BedManagementActions => {
    const validation = usePatientValidation();
    const bedAudit = useBedAudit(record);

    // Use a ref to keep record stable in callbacks
    const recordRef = useRef(record);
    useEffect(() => {
        recordRef.current = record;
    }, [record]);

    // ========================================================================
    // Dispatcher
    // ========================================================================

    const dispatch = useCallback((action: BedAction) => {
        const currentRecord = recordRef.current;
        if (!currentRecord) return;

        // 1. Validation (for specific actions)
        if (action.type === 'UPDATE_PATIENT') {
            const result = validation.processFieldValue(action.field, action.value);
            if (!result.valid) {
                console.warn(`Validation failed for ${action.field}:`, result.error);
                return;
            }
            action.value = result.value;
        } else if (action.type === 'UPDATE_PATIENT_MULTIPLE') {
            // Validate all fields in the batch
            const validatedFields: Partial<PatientData> = {};
            for (const [key, value] of Object.entries(action.fields)) {
                const result = validation.processFieldValue(key as keyof PatientData, value as PatientFieldValue);
                if (result.valid) {
                    (validatedFields as Record<string, unknown>)[key] = result.value;
                }
            }
            action.fields = validatedFields;
        }

        // 2. Audit Logging
        // We log *before* applying the patch to capture the intent
        try {
            switch (action.type) {
                case 'UPDATE_PATIENT':
                    bedAudit.auditPatientChange(action.bedId, action.field, currentRecord.beds[action.bedId], action.value);
                    break;
                case 'UPDATE_CUDYR':
                    bedAudit.auditCudyrChange(action.bedId, action.field, action.value);
                    break;
                case 'UPDATE_CLINICAL_CRIB_CUDYR':
                    bedAudit.auditCribCudyrChange(action.bedId, action.field, action.value);
                    break;
                case 'CLEAR_PATIENT': {
                    const bed = currentRecord.beds[action.bedId];
                    if (bed.patientName) {
                        bedAudit.auditPatientCleared(action.bedId, bed.patientName, bed.rut);
                    }
                    break;
                }
                case 'TOGGLE_BLOCK_BED':
                    // Audit handled in reducer-like logic or separate audit hook? 
                    // For now, simple logging here or moving useBedOperations audit logic here.
                    // Ideally, audit should be decoupled (observer pattern), but we keep it direct for now.
                    break;
                case 'TOGGLE_BED_TYPE': {
                    const bedDef = BEDS.find(b => b.id === action.bedId);
                    if (bedDef) {
                        const fromType = getBedTypeForRecord(bedDef, currentRecord);
                        const toType = fromType === BedType.UTI ? BedType.UCI : BedType.UTI;
                        bedAudit.auditPatientModified(action.bedId, {
                            action: 'toggle_bed_type',
                            from: fromType,
                            to: toType
                        });
                    }
                    break;
                }
            }
        } catch (e) {
            console.error('Audit logging failed', e);
        }

        // 3. Reducer (Calculate Patch) & 4. Apply Patch
        try {
            const patch = bedManagementReducer(currentRecord, action);
            if (patch) {
                patchRecord(patch);
            }
        } catch (e) {
            console.warn('Bed management action failed:', e);
        }
    }, [validation, patchRecord, bedAudit]);

    // ========================================================================
    // Action Creators (Adapters to match BedManagementActions interface)
    // ========================================================================

    const updatePatient = useCallback((bedId: string, field: keyof PatientData, value: PatientFieldValue) => {
        dispatch({ type: 'UPDATE_PATIENT', bedId, field, value });
    }, [dispatch]);

    const updatePatientMultiple = useCallback((bedId: string, fields: Partial<PatientData>) => {
        dispatch({ type: 'UPDATE_PATIENT_MULTIPLE', bedId, fields });
    }, [dispatch]);

    const updateCudyr = useCallback((bedId: string, field: keyof CudyrScore, value: number) => {
        dispatch({ type: 'UPDATE_CUDYR', bedId, field, value });
    }, [dispatch]);

    const updateClinicalCrib = useCallback((bedId: string, field: keyof PatientData | 'create' | 'remove', value?: PatientFieldValue) => {
        if (field === 'create') {
            dispatch({ type: 'CREATE_CLINICAL_CRIB', bedId });
        } else if (field === 'remove') {
            dispatch({ type: 'REMOVE_CLINICAL_CRIB', bedId });
        } else {
            dispatch({ type: 'UPDATE_CLINICAL_CRIB', bedId, field, value: value! });
        }
    }, [dispatch]);

    const updateClinicalCribMultiple = useCallback((bedId: string, fields: Partial<PatientData>) => {
        dispatch({ type: 'UPDATE_CLINICAL_CRIB_MULTIPLE', bedId, fields });
    }, [dispatch]);

    const updateClinicalCribCudyr = useCallback((bedId: string, field: keyof CudyrScore, value: number) => {
        dispatch({ type: 'UPDATE_CLINICAL_CRIB_CUDYR', bedId, field, value });
    }, [dispatch]);

    const clearPatient = useCallback((bedId: string) => {
        dispatch({ type: 'CLEAR_PATIENT', bedId });
    }, [dispatch]);

    // Legacy bulk operation - handled separately or via reducer loop?
    // It's cleaner to keep the clearAll logic in reducer if possible, but BEDS dependency makes it tricky
    // Re-using the logic from useBedOperations but wrapped
    const clearAllBeds = useCallback(() => {
        dispatch({ type: 'CLEAR_ALL_BEDS' });
    }, [dispatch]);

    const moveOrCopyPatient = useCallback((type: 'move' | 'copy', sourceBedId: string, targetBedId: string) => {
        if (type === 'move') dispatch({ type: 'MOVE_PATIENT', sourceBedId, targetBedId });
        else dispatch({ type: 'COPY_PATIENT', sourceBedId, targetBedId });
    }, [dispatch]);

    const toggleBlockBed = useCallback((bedId: string, reason?: string) => {
        dispatch({ type: 'TOGGLE_BLOCK_BED', bedId, reason });
    }, [dispatch]);

    const updateBlockedReason = useCallback((bedId: string, reason: string) => {
        dispatch({ type: 'UPDATE_BLOCKED_REASON', bedId, reason });
    }, [dispatch]);

    const toggleExtraBed = useCallback((bedId: string) => {
        dispatch({ type: 'TOGGLE_EXTRA_BED', bedId });
    }, [dispatch]);

    const toggleBedType = useCallback((bedId: string) => {
        dispatch({ type: 'TOGGLE_BED_TYPE', bedId });
    }, [dispatch]);

    // ========================================================================
    // Public API
    // ========================================================================
    return useMemo(() => ({
        updatePatient,
        updatePatientMultiple,
        updateClinicalCrib,
        updateClinicalCribMultiple,
        updateClinicalCribCudyr,
        updateCudyr,
        clearPatient,
        clearAllBeds,
        moveOrCopyPatient,
        toggleBlockBed,
        updateBlockedReason,
        toggleExtraBed,
        toggleBedType,
    }), [
        updatePatient,
        updatePatientMultiple,
        updateClinicalCrib,
        updateClinicalCribMultiple,
        updateClinicalCribCudyr,
        updateCudyr,
        clearPatient,
        clearAllBeds,
        moveOrCopyPatient,
        toggleBlockBed,
        updateBlockedReason,
        toggleExtraBed,
        toggleBedType
    ]);
};
