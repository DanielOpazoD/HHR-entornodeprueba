import { useMemo, useCallback, useRef, useEffect } from 'react';
import { DailyRecord, DischargeData, DischargeType, PatientData } from '@/types';
import { createEmptyPatient } from '@/services/factories/patientFactory';
import { BEDS } from '@/constants';
import { logPatientDischarge } from '@/services/admin/auditService';

export type DischargeTarget = 'mother' | 'baby' | 'both';

export const usePatientDischarges = (
    record: DailyRecord | null,
    saveAndUpdate: (updatedRecord: DailyRecord) => void
) => {
    const recordRef = useRef(record);
    useEffect(() => { recordRef.current = record; }, [record]);

    const addDischarge = useCallback((
        bedId: string,
        status: 'Vivo' | 'Fallecido',
        cribStatus?: 'Vivo' | 'Fallecido',
        dischargeType?: string,
        dischargeTypeOther?: string,
        time?: string,
        target: DischargeTarget = 'both'
    ) => {
        const currentRecord = recordRef.current;
        if (!currentRecord) return;
        const patient = currentRecord.beds[bedId];
        const bedDef = BEDS.find(b => b.id === bedId);

        // Prevent ghost patients (empty bed discharge)
        if (!patient.patientName) {
            console.warn("Attempted to discharge empty bed:", bedId);
            return;
        }

        const newDischarges: DischargeData[] = [];
        const updatedBeds = { ...currentRecord.beds };

        // Handle based on target
        if (target === 'mother' || target === 'both') {
            // Create discharge record for mother/main patient
            newDischarges.push({
                id: crypto.randomUUID(),
                bedName: bedDef?.name || bedId,
                bedId: bedId,
                bedType: bedDef?.type || '',
                patientName: patient.patientName,
                rut: patient.rut,
                diagnosis: patient.pathology,
                time: time || '',
                status: status,
                dischargeType: status === 'Vivo' ? (dischargeType as DischargeType) : undefined,
                dischargeTypeOther: dischargeType === 'Otra' ? dischargeTypeOther : undefined,
                age: patient.age,
                insurance: patient.insurance,
                origin: patient.origin,
                isRapanui: patient.isRapanui,
                originalData: JSON.parse(JSON.stringify(patient)),
                isNested: false
            });

            // Audit Logging for Main Patient
            logPatientDischarge(bedId, patient.patientName, patient.rut, status, currentRecord.date);
        }

        if (target === 'baby' || target === 'both') {
            // Only if clinical crib exists
            if (patient.clinicalCrib && patient.clinicalCrib.patientName && cribStatus) {
                newDischarges.push({
                    id: crypto.randomUUID(),
                    bedName: (bedDef?.name || bedId) + " (Cuna)",
                    bedId: bedId,
                    bedType: 'Cuna',
                    patientName: patient.clinicalCrib.patientName,
                    rut: patient.clinicalCrib.rut,
                    diagnosis: patient.clinicalCrib.pathology,
                    time: time || '',
                    status: cribStatus,
                    age: patient.clinicalCrib.age,
                    insurance: patient.insurance,
                    origin: patient.origin,
                    isRapanui: patient.isRapanui,
                    originalData: JSON.parse(JSON.stringify(patient.clinicalCrib)),
                    isNested: true
                });

                // Audit Logging for RN
                logPatientDischarge(bedId, patient.clinicalCrib.patientName, patient.clinicalCrib.rut, cribStatus, currentRecord.date);
            }
        }

        // Update bed state based on target
        if (target === 'both') {
            // Clear the entire bed
            const cleanPatient = createEmptyPatient(bedId);
            cleanPatient.location = updatedBeds[bedId].location;
            updatedBeds[bedId] = cleanPatient;
        } else if (target === 'mother') {
            // Promote RN to main patient
            if (patient.clinicalCrib && patient.clinicalCrib.patientName) {
                const promotedPatient: PatientData = {
                    ...createEmptyPatient(bedId),
                    ...patient.clinicalCrib,
                    location: patient.location,
                    bedMode: 'Cama', // Switch from Cuna to Cama mode
                    clinicalCrib: undefined, // No more clinical crib
                    hasCompanionCrib: false
                };
                updatedBeds[bedId] = promotedPatient;
            } else {
                // No clinical crib to promote, just clear the bed
                const cleanPatient = createEmptyPatient(bedId);
                cleanPatient.location = updatedBeds[bedId].location;
                updatedBeds[bedId] = cleanPatient;
            }
        } else if (target === 'baby') {
            // Keep mother, remove clinical crib
            updatedBeds[bedId] = {
                ...patient,
                clinicalCrib: undefined
            };
        }

        saveAndUpdate({
            ...currentRecord,
            beds: updatedBeds,
            discharges: [...(currentRecord.discharges || []), ...newDischarges]
        });
    }, [saveAndUpdate]);

    const updateDischarge = useCallback((
        id: string,
        status: 'Vivo' | 'Fallecido',
        dischargeType?: string,
        dischargeTypeOther?: string,
        time?: string
    ) => {
        const currentRecord = recordRef.current;
        if (!currentRecord) return;
        const updatedDischarges = currentRecord.discharges.map(d => d.id === id ? {
            ...d,
            status,
            dischargeType: status === 'Vivo' ? (dischargeType as DischargeType) : undefined,
            dischargeTypeOther: dischargeType === 'Otra' ? dischargeTypeOther : undefined,
            time: time ?? d.time
        } : d);
        saveAndUpdate({ ...currentRecord, discharges: updatedDischarges });
    }, [saveAndUpdate]);

    const deleteDischarge = useCallback((id: string) => {
        const currentRecord = recordRef.current;
        if (!currentRecord) return;
        saveAndUpdate({ ...currentRecord, discharges: currentRecord.discharges.filter(d => d.id !== id) });
    }, [saveAndUpdate]);

    const undoDischarge = useCallback((id: string) => {
        const currentRecord = recordRef.current;
        if (!currentRecord) return;
        const discharge = currentRecord.discharges.find(d => d.id === id);
        if (!discharge || !discharge.originalData) return;

        const updatedBeds = { ...currentRecord.beds };
        const bedData = updatedBeds[discharge.bedId];

        // Logic for undoing
        if (!discharge.isNested) {
            // Restore Main Patient
            if (bedData.patientName) {
                alert(`No se puede deshacer el alta de ${discharge.patientName} porque la cama ${discharge.bedName} ya está ocupada por otro paciente.`);
                return;
            }
            const empty = createEmptyPatient(discharge.bedId);
            updatedBeds[discharge.bedId] = {
                ...empty,
                ...discharge.originalData,
                location: bedData.location
            };

        } else {
            // Restore Nested Patient (Clinical Crib)
            if (!bedData.patientName) {
                alert(`Para restaurar la cuna clínica, primero debe estar ocupada la cama principal(Madre / Tutor).`);
                return;
            }
            if (bedData.clinicalCrib && bedData.clinicalCrib.patientName) {
                alert(`No se puede deshacer el alta de ${discharge.patientName} porque ya existe una cuna clínica ocupada en esta cama.`);
                return;
            }
            updatedBeds[discharge.bedId] = {
                ...bedData,
                clinicalCrib: discharge.originalData
            };
        }

        saveAndUpdate({
            ...currentRecord,
            beds: updatedBeds,
            discharges: currentRecord.discharges.filter(d => d.id !== id)
        });
    }, [saveAndUpdate]);

    return useMemo(() => ({
        addDischarge,
        updateDischarge,
        deleteDischarge,
        undoDischarge
    }), [addDischarge, updateDischarge, deleteDischarge, undoDischarge]);
};
