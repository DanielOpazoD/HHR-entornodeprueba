import { useCallback, useRef, useEffect } from 'react';
import { DailyRecord, PatientData, CudyrScore, PatientFieldValue } from '@/types';
import { AuditDeviceChange, AuditDeviceChangesMap } from '@/types/audit';
import { useAuditContext } from '@/context/AuditContext';
import { getAttributedAuthors } from '@/services/admin/attributionService';
import { logPatientAdmission } from '@/services/admin/auditService';

/**
 * useBedAudit Hook
 * 
 * Handles all auditing and logging for bed and patient modifications.
 */
export const useBedAudit = (record: DailyRecord | null) => {
    const { logDebouncedEvent, userId } = useAuditContext();
    const recordRef = useRef(record);

    useEffect(() => {
        recordRef.current = record;
    }, [record]);

    /**
     * Audit Logging for patient admission or modification
     */
    const auditPatientChange = useCallback((
        bedId: string,
        field: keyof PatientData,
        oldPatient: PatientData,
        newValue: PatientFieldValue
    ) => {
        const currentRecord = recordRef.current;
        if (!currentRecord) return;

        const oldValue = oldPatient[field];

        if (field === 'patientName') {
            const oldName = oldPatient.patientName;
            const newName = newValue as string;

            // Admission: Empty -> Name
            if (!oldName && newName) {
                logPatientAdmission(bedId, newName, oldPatient.rut, oldPatient.pathology, currentRecord.date);
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
                    currentRecord.date
                );
            }
        } else if (field === 'deviceDetails') {
            const oldDevices = (oldPatient.deviceDetails || {}) as Record<string, { installationDate?: string; notes?: string } | undefined>;
            const newDevices = (newValue || {}) as Record<string, { installationDate?: string; notes?: string } | undefined>;

            // Detect which device changed
            const allKeys = Array.from(new Set([...Object.keys(oldDevices), ...Object.keys(newDevices)]));
            const deviceChanges: AuditDeviceChangesMap = {};

            allKeys.forEach(device => {
                const oldD = oldDevices[device];
                const newD = newDevices[device];
                if (JSON.stringify(oldD) !== JSON.stringify(newD)) {
                    deviceChanges[device] = { old: oldD || 'N/A', new: newD || 'Eliminado' } as AuditDeviceChange;
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
                    currentRecord.date
                );
            }
        } else if (oldValue !== newValue) {
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
                        changes: { [field]: { old: oldValue, new: newValue } }
                    },
                    oldPatient.rut,
                    currentRecord.date
                );
            }
        }
    }, [logDebouncedEvent]);

    const auditCudyrChange = useCallback((
        bedId: string,
        field: keyof CudyrScore,
        value: number
    ) => {
        const currentRecord = recordRef.current;
        if (!currentRecord) return;

        const patient = currentRecord.beds[bedId];
        if (patient?.patientName) {
            const authors = getAttributedAuthors(userId, currentRecord);
            const oldValue = patient.cudyr?.[field] || 0;

            if (oldValue !== value) {
                logDebouncedEvent(
                    'CUDYR_MODIFIED',
                    'dailyRecord',
                    currentRecord.date,
                    {
                        patientName: patient.patientName,
                        bedId,
                        field,
                        value,
                        oldValue
                    },
                    patient.rut,
                    currentRecord.date,
                    authors
                );
            }
        }
    }, [logDebouncedEvent, userId]);

    const auditCribCudyrChange = useCallback((
        bedId: string,
        field: keyof CudyrScore,
        value: number
    ) => {
        const currentRecord = recordRef.current;
        if (!currentRecord) return;

        const crib = currentRecord.beds[bedId]?.clinicalCrib;
        if (crib?.patientName) {
            const authors = getAttributedAuthors(userId, currentRecord);
            const oldValue = crib.cudyr?.[field] || 0;

            if (oldValue !== value) {
                logDebouncedEvent(
                    'CUDYR_MODIFIED',
                    'dailyRecord',
                    currentRecord.date,
                    {
                        patientName: crib.patientName,
                        bedId: `${bedId}-crib`,
                        field,
                        value,
                        oldValue
                    },
                    crib.rut,
                    currentRecord.date,
                    authors
                );
            }
        }
    }, [logDebouncedEvent, userId]);

    const auditPatientCleared = useCallback((bedId: string, patientName: string, rut?: string) => {
        const currentRecord = recordRef.current;
        if (!currentRecord) return;
        logDebouncedEvent(
            'PATIENT_CLEARED',
            'patient',
            bedId,
            { patientName, bedId },
            rut,
            currentRecord.date
        );
    }, [logDebouncedEvent]);

    const auditPatientModified = useCallback((bedId: string, details: Record<string, unknown>) => {
        const currentRecord = recordRef.current;
        if (!currentRecord) return;
        const patient = currentRecord.beds[bedId];
        logDebouncedEvent(
            'PATIENT_MODIFIED',
            'patient',
            bedId,
            {
                patientName: patient?.patientName,
                ...details
            },
            patient?.rut,
            currentRecord.date
        );
    }, [logDebouncedEvent]);

    return {
        auditPatientChange,
        auditCudyrChange,
        auditCribCudyrChange,
        auditPatientCleared,
        auditPatientModified
    };
};
