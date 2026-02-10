import { useMemo, useCallback, useRef, useEffect } from 'react';
import { DailyRecord, TransferData } from '@/types';
import { createEmptyPatient } from '@/services/factories/patientFactory';
import { BEDS } from '@/constants';
import { logPatientTransfer } from '@/services/admin/auditService';

export const usePatientTransfers = (
    record: DailyRecord | null,
    saveAndUpdate: (updatedRecord: DailyRecord) => void
) => {
    const recordRef = useRef(record);
    useEffect(() => { recordRef.current = record; }, [record]);

    const addTransfer = useCallback((bedId: string, method: string, center: string, centerOther: string, escort?: string, time?: string) => {
        const currentRecord = recordRef.current;
        if (!currentRecord) return;
        const patient = currentRecord.beds[bedId];
        const bedDef = BEDS.find(b => b.id === bedId);

        // Prevent ghost patients (empty bed transfer)
        if (!patient.patientName) {
            console.warn("Attempted to transfer empty bed:", bedId);
            return;
        }

        const newTransfers: TransferData[] = [];

        // 1. Main Patient
        newTransfers.push({
            id: crypto.randomUUID(),
            bedName: bedDef?.name || bedId,
            bedId: bedId,
            bedType: bedDef?.type || '',
            patientName: patient.patientName,
            rut: patient.rut,
            diagnosis: patient.pathology,
            time: time || '',
            evacuationMethod: method,
            receivingCenter: center,
            receivingCenterOther: centerOther,
            transferEscort: escort,
            age: patient.age,
            insurance: patient.insurance,
            origin: patient.origin,
            isRapanui: patient.isRapanui,
            originalData: JSON.parse(JSON.stringify(patient)),
            isNested: false
        });

        // 2. Clinical Crib Patient
        if (patient.clinicalCrib && patient.clinicalCrib.patientName) {
            newTransfers.push({
                id: crypto.randomUUID(),
                bedName: (bedDef?.name || bedId) + " (Cuna)",
                bedId: bedId,
                bedType: 'Cuna',
                patientName: patient.clinicalCrib.patientName,
                rut: patient.clinicalCrib.rut,
                diagnosis: patient.clinicalCrib.pathology,
                time: time || '',
                evacuationMethod: method,
                receivingCenter: center,
                receivingCenterOther: centerOther,
                transferEscort: escort,
                age: patient.clinicalCrib.age,
                insurance: patient.insurance,
                origin: patient.origin,
                isRapanui: patient.isRapanui,
                originalData: JSON.parse(JSON.stringify(patient.clinicalCrib)),
                isNested: true
            });
        }

        const updatedBeds = { ...currentRecord.beds };
        const cleanPatient = createEmptyPatient(bedId);
        cleanPatient.location = updatedBeds[bedId].location;
        updatedBeds[bedId] = cleanPatient;
        saveAndUpdate({
            ...currentRecord,
            beds: updatedBeds,
            transfers: [...(currentRecord.transfers || []), ...newTransfers]
        });

        // Audit Logging for Main Patient
        logPatientTransfer(bedId, patient.patientName, patient.rut, center, currentRecord.date);
    }, [saveAndUpdate]);

    const updateTransfer = useCallback((id: string, updates: Partial<TransferData>) => {
        const currentRecord = recordRef.current;
        if (!currentRecord) return;
        const updatedTransfers = currentRecord.transfers.map(t => t.id === id ? { ...t, ...updates } : t);
        saveAndUpdate({ ...currentRecord, transfers: updatedTransfers });
    }, [saveAndUpdate]);

    const deleteTransfer = useCallback((id: string) => {
        const currentRecord = recordRef.current;
        if (!currentRecord) return;
        saveAndUpdate({ ...currentRecord, transfers: currentRecord.transfers.filter(t => t.id !== id) });
    }, [saveAndUpdate]);

    const undoTransfer = useCallback((id: string) => {
        const currentRecord = recordRef.current;
        if (!currentRecord) return;
        const transfer = currentRecord.transfers.find(t => t.id === id);
        if (!transfer || !transfer.originalData) return;

        const updatedBeds = { ...currentRecord.beds };
        const bedData = updatedBeds[transfer.bedId];

        if (!transfer.isNested) {
            // Restore Main Patient
            if (bedData.patientName) {
                alert(`No se puede deshacer el traslado de ${transfer.patientName} porque la cama ${transfer.bedName} ya está ocupada.`);
                return;
            }
            const empty = createEmptyPatient(transfer.bedId);
            updatedBeds[transfer.bedId] = {
                ...empty,
                ...transfer.originalData,
                location: bedData.location
            };

        } else {
            // Restore Nested Patient
            if (!bedData.patientName) {
                alert(`Para restaurar la cuna clínica, primero debe estar ocupada la cama principal.`);
                return;
            }
            if (bedData.clinicalCrib && bedData.clinicalCrib.patientName) {
                alert(`No se puede deshacer el traslado de ${transfer.patientName} porque ya existe una cuna clínica ocupada.`);
                return;
            }
            updatedBeds[transfer.bedId] = {
                ...bedData,
                clinicalCrib: transfer.originalData
            };
        }

        saveAndUpdate({ ...currentRecord, beds: updatedBeds, transfers: currentRecord.transfers.filter(t => t.id !== id) });
    }, [saveAndUpdate]);

    return useMemo(() => ({
        addTransfer,
        updateTransfer,
        deleteTransfer,
        undoTransfer
    }), [addTransfer, updateTransfer, deleteTransfer, undoTransfer]);
};
