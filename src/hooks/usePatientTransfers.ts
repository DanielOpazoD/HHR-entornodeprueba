import { DailyRecord, TransferData } from '@/types';
import { createEmptyPatient } from '@/services/factories/patientFactory';
import { BEDS } from '@/constants';
import { logPatientTransfer } from '@/services/admin/auditService';

export const usePatientTransfers = (
    record: DailyRecord | null,
    saveAndUpdate: (updatedRecord: DailyRecord) => void
) => {

    const addTransfer = (bedId: string, method: string, center: string, centerOther: string, escort?: string, time?: string) => {
        if (!record) return;
        const patient = record.beds[bedId];
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

        const updatedBeds = { ...record.beds };
        const cleanPatient = createEmptyPatient(bedId);
        cleanPatient.location = updatedBeds[bedId].location;
        updatedBeds[bedId] = cleanPatient;
        saveAndUpdate({
            ...record,
            beds: updatedBeds,
            transfers: [...(record.transfers || []), ...newTransfers]
        });

        // Audit Logging for Main Patient
        logPatientTransfer(bedId, patient.patientName, patient.rut, center, record.date);
    };

    const updateTransfer = (id: string, updates: Partial<TransferData>) => {
        if (!record) return;
        const updatedTransfers = record.transfers.map(t => t.id === id ? { ...t, ...updates } : t);
        saveAndUpdate({ ...record, transfers: updatedTransfers });
    };

    const deleteTransfer = (id: string) => {
        if (!record) return;
        saveAndUpdate({ ...record, transfers: record.transfers.filter(t => t.id !== id) });
    };

    const undoTransfer = (id: string) => {
        if (!record) return;
        const transfer = record.transfers.find(t => t.id === id);
        if (!transfer || !transfer.originalData) return;

        const updatedBeds = { ...record.beds };
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

        saveAndUpdate({ ...record, beds: updatedBeds, transfers: record.transfers.filter(t => t.id !== id) });
    };

    return {
        addTransfer,
        updateTransfer,
        deleteTransfer,
        undoTransfer
    };
};
