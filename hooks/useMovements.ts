
import { DailyRecord, DischargeData, DischargeType, TransferData } from '../types';
import { createEmptyPatient } from '../services/factories/patientFactory';
import { BEDS } from '../constants';
import { logPatientDischarge, logPatientTransfer } from '../services/admin/auditService';

export type DischargeTarget = 'mother' | 'baby' | 'both';

/**
 * useMovements Hook
 * Consolidated management for patient movements (discharges and transfers).
 */
export const useMovements = (
    record: DailyRecord | null,
    saveAndUpdate: (updatedRecord: DailyRecord) => void
) => {

    // ========================================================================
    // Discharge Operations
    // ========================================================================

    const addDischarge = (
        bedId: string,
        status: 'Vivo' | 'Fallecido',
        cribStatus?: 'Vivo' | 'Fallecido',
        dischargeType?: string,
        dischargeTypeOther?: string,
        time?: string,
        target: DischargeTarget = 'both'
    ) => {
        if (!record) return;
        const patient = record.beds[bedId];
        const bedDef = BEDS.find(b => b.id === bedId);

        if (!patient.patientName) return;

        const newDischarges: DischargeData[] = [];
        const updatedBeds = { ...record.beds };

        if (target === 'mother' || target === 'both') {
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
            logPatientDischarge(bedId, patient.patientName, patient.rut, status, record.date);
        }

        if ((target === 'baby' || target === 'both') && patient.clinicalCrib?.patientName && cribStatus) {
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
            logPatientDischarge(bedId, patient.clinicalCrib.patientName, patient.clinicalCrib.rut, cribStatus, record.date);
        }

        if (target === 'both') {
            const cleanPatient = createEmptyPatient(bedId);
            cleanPatient.location = updatedBeds[bedId].location;
            updatedBeds[bedId] = cleanPatient;
        } else if (target === 'mother') {
            if (patient.clinicalCrib?.patientName) {
                updatedBeds[bedId] = {
                    ...createEmptyPatient(bedId),
                    ...patient.clinicalCrib,
                    location: patient.location,
                    bedMode: 'Cuna',
                    clinicalCrib: undefined,
                    hasCompanionCrib: false
                };
            } else {
                const cleanPatient = createEmptyPatient(bedId);
                cleanPatient.location = updatedBeds[bedId].location;
                updatedBeds[bedId] = cleanPatient;
            }
        } else if (target === 'baby') {
            updatedBeds[bedId] = { ...patient, clinicalCrib: undefined };
        }

        saveAndUpdate({
            ...record,
            beds: updatedBeds,
            discharges: [...(record.discharges || []), ...newDischarges]
        });
    };

    const updateDischarge = (id: string, status: 'Vivo' | 'Fallecido', dischargeType?: string, dischargeTypeOther?: string, time?: string) => {
        if (!record) return;
        saveAndUpdate({
            ...record,
            discharges: record.discharges.map(d => d.id === id ? {
                ...d,
                status,
                dischargeType: status === 'Vivo' ? (dischargeType as DischargeType) : undefined,
                dischargeTypeOther: dischargeType === 'Otra' ? dischargeTypeOther : undefined,
                time: time ?? d.time
            } : d)
        });
    };

    const deleteDischarge = (id: string) => {
        if (!record) return;
        saveAndUpdate({ ...record, discharges: record.discharges.filter(d => d.id !== id) });
    };

    const undoDischarge = (id: string) => {
        if (!record) return;
        const discharge = record.discharges.find(d => d.id === id);
        if (!discharge || !discharge.originalData) return;

        const updatedBeds = { ...record.beds };
        const bedData = updatedBeds[discharge.bedId];

        if (!discharge.isNested) {
            if (bedData.patientName) {
                alert(`No se puede deshacer el alta de ${discharge.patientName} porque la cama ${discharge.bedName} ya está ocupada.`);
                return;
            }
            updatedBeds[discharge.bedId] = { ...createEmptyPatient(discharge.bedId), ...discharge.originalData, location: bedData.location };
        } else {
            if (!bedData.patientName || (bedData.clinicalCrib && bedData.clinicalCrib.patientName)) return;
            updatedBeds[discharge.bedId] = { ...bedData, clinicalCrib: discharge.originalData };
        }

        saveAndUpdate({ ...record, beds: updatedBeds, discharges: record.discharges.filter(d => d.id !== id) });
    };

    // ========================================================================
    // Transfer Operations
    // ========================================================================

    const addTransfer = (bedId: string, method: string, center: string, centerOther: string, escort?: string, time?: string) => {
        if (!record) return;
        const patient = record.beds[bedId];
        const bedDef = BEDS.find(b => b.id === bedId);

        if (!patient.patientName) return;

        const newTransfers: TransferData[] = [];
        const baseTransfer = {
            id: '',
            bedId,
            time: time || '',
            evacuationMethod: method,
            receivingCenter: center,
            receivingCenterOther: centerOther,
            transferEscort: escort,
            insurance: patient.insurance,
            origin: patient.origin,
            isRapanui: patient.isRapanui
        };

        newTransfers.push({
            ...baseTransfer,
            id: crypto.randomUUID(),
            bedName: bedDef?.name || bedId,
            bedType: bedDef?.type || '',
            patientName: patient.patientName,
            rut: patient.rut,
            diagnosis: patient.pathology,
            age: patient.age,
            originalData: JSON.parse(JSON.stringify(patient)),
            isNested: false
        });

        if (patient.clinicalCrib?.patientName) {
            newTransfers.push({
                ...baseTransfer,
                id: crypto.randomUUID(),
                bedName: (bedDef?.name || bedId) + " (Cuna)",
                bedType: 'Cuna',
                patientName: patient.clinicalCrib.patientName,
                rut: patient.clinicalCrib.rut,
                diagnosis: patient.clinicalCrib.pathology,
                age: patient.clinicalCrib.age,
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
        logPatientTransfer(bedId, patient.patientName, patient.rut, center, record.date);
    };

    const updateTransfer = (id: string, updates: Partial<TransferData>) => {
        if (!record) return;
        saveAndUpdate({ ...record, transfers: record.transfers.map(t => t.id === id ? { ...t, ...updates } : t) });
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
            if (bedData.patientName) {
                alert(`No se puede deshacer el traslado porque la cama ya está ocupada.`);
                return;
            }
            updatedBeds[transfer.bedId] = { ...createEmptyPatient(transfer.bedId), ...transfer.originalData, location: bedData.location };
        } else {
            if (!bedData.patientName || (bedData.clinicalCrib && bedData.clinicalCrib.patientName)) return;
            updatedBeds[transfer.bedId] = { ...bedData, clinicalCrib: transfer.originalData };
        }

        saveAndUpdate({ ...record, beds: updatedBeds, transfers: record.transfers.filter(t => t.id !== id) });
    };

    return {
        addDischarge, updateDischarge, deleteDischarge, undoDischarge,
        addTransfer, updateTransfer, deleteTransfer, undoTransfer
    };
};
