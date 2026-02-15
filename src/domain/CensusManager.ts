import { ActionState, DischargeState, TransferState } from '@/features/census/types/censusActionTypes';
import { CMAData, DailyRecord, PatientData } from '@/types';
import {
    DEFAULT_DISCHARGE_STATUS,
    DEFAULT_TRANSFER_ESCORT,
    EvacuationMethod,
    ReceivingCenter
} from '@/constants';

/**
 * CensusManager
 * 
 * Pure TS class to handle the business logic of census operations.
 * Decoupled from React to ensure testability and rule enforcement consistency.
 */
export class CensusManager {
    /**
     * Prepares data for a patient discharge.
     * Enforces consistency between mother and baby if applicable.
     */
    static prepareDischarge(patient: PatientData, bedId: string): Partial<DischargeState> {
        const hasBaby = !!patient.clinicalCrib;
        return {
            bedId,
            recordId: undefined,
            isOpen: true,
            status: DEFAULT_DISCHARGE_STATUS,
            hasClinicalCrib: hasBaby,
            clinicalCribName: patient.clinicalCrib?.patientName,
            clinicalCribStatus: DEFAULT_DISCHARGE_STATUS,
            time: new Date().toTimeString().slice(0, 5),
            dischargeTarget: hasBaby ? 'both' : undefined
        };
    }

    /**
     * Prepares data for a patient transfer.
     */
    static prepareTransfer(
        patient: PatientData,
        bedId: string,
        defaultMethods: { evacuation: EvacuationMethod, center: ReceivingCenter }
    ): Partial<TransferState> {
        const hasBaby = !!patient.clinicalCrib;
        return {
            bedId,
            recordId: undefined,
            isOpen: true,
            evacuationMethod: defaultMethods.evacuation,
            receivingCenter: defaultMethods.center,
            transferEscort: DEFAULT_TRANSFER_ESCORT,
            time: new Date().toTimeString().slice(0, 5),
            hasClinicalCrib: hasBaby,
            clinicalCribName: patient.clinicalCrib?.patientName
        };
    }

    /**
     * Validates if a movement (Move/Copy) is valid within the census rules.
     */
    static validateMovement(state: ActionState, record: DailyRecord): { isValid: boolean, error?: string } {
        if (!state.sourceBedId || !state.targetBedId) return { isValid: false, error: 'Cama de origen o destino no especificada.' };

        const sourcePatient = record.beds[state.sourceBedId];
        const targetPatient = record.beds[state.targetBedId];

        if (!sourcePatient?.patientName) return { isValid: false, error: 'No hay paciente en la cama de origen.' };
        if (targetPatient?.patientName && state.sourceBedId !== state.targetBedId) {
            return { isValid: false, error: 'La cama de destino ya está ocupada.' };
        }

        return { isValid: true };
    }

    /**
     * Formats CMA discharge data from patient information.
     */
    static formatCMAData(patient: PatientData, bedId: string): Omit<CMAData, 'id' | 'timestamp'> {
        const now = new Date();
        const dischargeTime = now.toTimeString().slice(0, 5);

        return {
            bedName: bedId,
            patientName: patient.patientName || '',
            rut: patient.rut || '',
            age: patient.age || '',
            birthDate: patient.birthDate,
            biologicalSex: patient.biologicalSex,
            insurance: patient.insurance,
            admissionOrigin: patient.admissionOrigin,
            admissionOriginDetails: patient.admissionOriginDetails,
            origin: patient.origin,
            isRapanui: patient.isRapanui,
            diagnosis: patient.pathology || '',
            cie10Code: patient.cie10Code,
            cie10Description: patient.cie10Description,
            specialty: patient.specialty || '',
            interventionType: 'Cirugía Mayor Ambulatoria',
            dischargeTime,
            originalBedId: bedId,
            originalData: { ...patient }
        };
    }
}
