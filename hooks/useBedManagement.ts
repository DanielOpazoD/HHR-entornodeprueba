import { useCallback } from 'react';
import { DailyRecord, PatientData, CudyrScore, PatientFieldValue, AuditAction } from '../types';
import { useAuditContext } from '../context/AuditContext';
import { getAttributedAuthors } from '../services/admin/attributionService';
import { usePatientValidation } from './usePatientValidation';
import { useBedOperations } from './useBedOperations';
import { useClinicalCrib } from './useClinicalCrib';
import { logPatientAdmission } from '../services/admin/auditService';
import { DailyRecordPatchLoose } from './useDailyRecordTypes';

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
    patchRecord: (partial: DailyRecordPatchLoose) => Promise<void>
): BedManagementActions => {
    const { logDebouncedEvent, userId } = useAuditContext();

    // ========================================================================
    // Compose Specialized Hooks
    // ========================================================================

    const validation = usePatientValidation();
    const bedOperations = useBedOperations(record, patchRecord);
    const cribActions = useClinicalCrib(record, saveAndUpdate, patchRecord);

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
        const oldValue = oldPatient[field];

        // Audit Logging for patient admission/modification
        if (field === 'patientName') {
            const oldName = oldPatient.patientName;
            const newName = processedValue as string;
            // Admission: Empty -> Name
            if (!oldName && newName) {
                logPatientAdmission(bedId, newName, oldPatient.rut, oldPatient.pathology, record.date);
            } else if (oldName && newName && oldName !== newName) {
                // Name modification
                logDebouncedEvent(
                    'PATIENT_MODIFIED',
                    'patient',
                    bedId,
                    {
                        patientName: newName,
                        changes: { [field]: { old: oldName, new: newName } }
                    },
                    oldPatient.rut,
                    record.date
                );
            }
        } else if (field === 'deviceDetails') {
            // Specialized auditing for invasive devices
            const oldDevices = (oldPatient.deviceDetails || {}) as Record<string, any>;
            const newDevices = (processedValue || {}) as Record<string, any>;

            // Detect which device changed
            const allKeys = Array.from(new Set([...Object.keys(oldDevices), ...Object.keys(newDevices)]));
            const deviceChanges: Record<string, any> = {};

            allKeys.forEach(device => {
                const oldD = oldDevices[device];
                const newD = newDevices[device];
                if (JSON.stringify(oldD) !== JSON.stringify(newD)) {
                    deviceChanges[device] = { old: oldD || 'N/A', new: newD || 'Eliminado' };
                }
            });

            if (Object.keys(deviceChanges).length > 0) {
                logDebouncedEvent(
                    'PATIENT_MODIFIED',
                    'patient',
                    bedId,
                    {
                        patientName: oldPatient.patientName,
                        changes: { deviceDetails: deviceChanges }
                    },
                    oldPatient.rut,
                    record.date
                );
            }
        } else if (oldValue !== processedValue) {
            // Critical fields logging
            const criticalFields: (keyof PatientData)[] = [
                'pathology', 'age', 'specialty', 'status', 'biologicalSex',
                'insurance', 'admissionOrigin', 'origin', 'admissionDate'
            ];

            if (criticalFields.includes(field)) {
                logDebouncedEvent(
                    'PATIENT_MODIFIED',
                    'patient',
                    bedId,
                    {
                        patientName: oldPatient.patientName,
                        changes: { [field]: { old: oldValue, new: processedValue } }
                    },
                    oldPatient.rut,
                    record.date
                );
            }
        }

        // Send an atomic patch to the database.
        // We use dot-notation (e.g., "beds.bed-1.patientName") so Firestore 
        // only updates that specific leaf node. This is critical for concurrency
        // as other users might be updating "beds.bed-2" at the same time.
        patchRecord({
            [`beds.${bedId}.${field}`]: processedValue
        });
    }, [record, validation, patchRecord, logPatientAdmission, logDebouncedEvent]);

    /**
     * Update multiple patient fields atomically
     */
    const updatePatientMultiple = useCallback((
        bedId: string,
        fields: Partial<PatientData>
    ) => {
        if (!record) return;

        const patches: DailyRecordPatchLoose = {};

        for (const [key, value] of Object.entries(fields)) {
            const field = key as keyof PatientData;
            const result = validation.processFieldValue(field, value as PatientFieldValue);

            if (result.valid) {
                patches[`beds.${bedId}.${key}`] = result.value;
            }
        }

        if (Object.keys(patches).length > 0) {
            patchRecord(patches);
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

        // Audit Log (Smart/Debounced)
        if (record.beds[bedId].patientName) {
            // Attribution logic for shared accounts (MINSAL requirement)
            const authors = getAttributedAuthors(userId, record);

            logDebouncedEvent(
                'CUDYR_MODIFIED',
                'dailyRecord',
                record.date,
                {
                    patientName: record.beds[bedId].patientName,
                    bedId,
                    field,
                    value,
                    oldValue: record.beds[bedId].cudyr?.[field] || 0
                },
                record.beds[bedId].rut,
                record.date,
                authors
            );
        }

        patchRecord({
            [`beds.${bedId}.cudyr.${field}`]: value
        });
    }, [record, patchRecord, logDebouncedEvent, userId]);

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

        const crib = record.beds[bedId]?.clinicalCrib;
        if (crib?.patientName) {
            const authors = getAttributedAuthors(userId, record);
            logDebouncedEvent(
                'CUDYR_MODIFIED',
                'dailyRecord',
                record.date,
                {
                    patientName: crib.patientName,
                    bedId: `${bedId}-crib`,
                    field,
                    value,
                    oldValue: crib.cudyr?.[field] || 0
                },
                crib.rut,
                record.date,
                authors
            );
        }

        patchRecord({
            [`beds.${bedId}.clinicalCrib.cudyr.${field}`]: value
        });
    }, [record, patchRecord, logDebouncedEvent, userId]);

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

