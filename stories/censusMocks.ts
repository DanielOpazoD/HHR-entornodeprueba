/**
 * Census & Cudyr Mocks for Storybook
 */

import { DailyRecord, PatientData, Specialty, PatientStatus, Statistics, CudyrScore } from '../types';
import { DailyRecordContextType } from '../hooks/useDailyRecordTypes';
import { BEDS } from '../constants';
import { createEmptyPatient } from '../services/factories/patientFactory';

export const createMockPatient = (overrides: Partial<PatientData> = {}): PatientData => {
    const bedId = overrides.bedId || 'bed-1';
    return {
        ...createEmptyPatient(bedId),
        patientName: 'Juan Pérez',
        rut: '12.345.678-9',
        age: '45 años',
        pathology: 'Neumonía Grave',
        specialty: Specialty.MEDICINA,
        status: PatientStatus.ESTABLE,
        admissionDate: '2026-01-01',
        ...overrides,
    };
};

export const createMockDailyRecord = (date: string = '2026-01-11'): DailyRecord => {
    const beds: Record<string, PatientData> = {};

    // Fill first 5 beds with mock data
    BEDS.slice(0, 5).forEach((bed, index) => {
        beds[bed.id] = createMockPatient({
            bedId: bed.id,
            patientName: index === 0 ? 'María García' :
                index === 1 ? 'Pedro Soto' :
                    index === 2 ? 'Ana López' : 'Juan Pérez',
            status: index % 2 === 0 ? PatientStatus.ESTABLE : PatientStatus.GRAVE,
            specialty: index % 2 === 0 ? Specialty.MEDICINA : Specialty.CIRUGIA,
        });
    });

    // Add a clinical crib to bed 1
    beds[BEDS[0].id].clinicalCrib = createMockPatient({
        bedId: BEDS[0].id,
        patientName: 'RN María García',
        age: '1 día',
        bedMode: 'Cuna',
    });

    // Add a blocked bed
    beds[BEDS[5].id] = createMockPatient({
        bedId: BEDS[5].id,
        patientName: '',
        isBlocked: true,
        blockedReason: 'Mantención',
    });

    // Fill the rest with empty patients
    BEDS.slice(6).forEach(bed => {
        beds[bed.id] = createEmptyPatient(bed.id);
    });

    return {
        date,
        beds,
        discharges: [
            {
                id: 'd1',
                bedName: 'Cama 101',
                bedId: 'bed-101',
                bedType: 'UTI',
                patientName: 'Luis Rojas',
                rut: '11.222.333-4',
                diagnosis: 'Fractura expuesta',
                time: '10:30',
                status: 'Vivo',
                dischargeType: 'Domicilio (Habitual)',
            }
        ],
        transfers: [
            {
                id: 't1',
                bedName: 'Cama 102',
                bedId: 'bed-102',
                bedType: 'MEDIA',
                patientName: 'Elena Torres',
                rut: '9.888.777-6',
                diagnosis: 'Colecistitis',
                time: '14:20',
                evacuationMethod: 'Ambulancia',
                receivingCenter: 'Hospital Salvador',
            }
        ],
        cma: [
            {
                id: 'c1',
                bedName: 'Pabellón 1',
                patientName: 'Carlos Ruiz',
                rut: '15.444.555-K',
                age: '32',
                diagnosis: 'Hernia Inguinal',
                specialty: 'Cirugía',
                interventionType: 'Cirugía Mayor Ambulatoria',
            }
        ],
        lastUpdated: new Date().toISOString(),
        schemaVersion: 1,
        nursesDayShift: ['Enf. Carla Bravo', 'Enf. Roberto Díaz'],
        nursesNightShift: ['Enf. Lucía Morán'],
        tensDayShift: ['TENS Mario Ruiz', 'TENS Julia Castro'],
        tensNightShift: ['TENS Sergio Peña'],
        activeExtraBeds: [],
        nurses: [], // Deprecated
    };
};

export const createMockStats = (overrides: Partial<Statistics> = {}): Statistics => ({
    occupiedBeds: 5,
    occupiedCribs: 1,
    clinicalCribsCount: 1,
    companionCribs: 0,
    totalCribsUsed: 1,
    totalHospitalized: 6,
    blockedBeds: 1,
    serviceCapacity: 17,
    availableCapacity: 12,
    ...overrides,
});

export const createMockCudyrScore = (overrides: Partial<CudyrScore> = {}): CudyrScore => ({
    changeClothes: 1,
    mobilization: 2,
    feeding: 1,
    elimination: 1,
    psychosocial: 1,
    surveillance: 1,
    vitalSigns: 2,
    fluidBalance: 1,
    oxygenTherapy: 1,
    airway: 1,
    proInterventions: 1,
    skinCare: 1,
    pharmacology: 1,
    invasiveElements: 1,
    ...overrides,
});


export const createMockDailyRecordContext = (overrides: Partial<DailyRecordContextType> = {}): DailyRecordContextType => {
    const record = createMockDailyRecord();
    return {
        record,
        syncStatus: 'idle',
        lastSyncTime: new Date(),
        createDay: () => { },
        generateDemo: () => { },
        resetDay: async () => { },
        refresh: () => { },
        updatePatient: () => { },
        updatePatientMultiple: () => { },
        updateClinicalCrib: () => { },
        updateClinicalCribMultiple: () => { },
        updateClinicalCribCudyr: () => { },
        updateCudyr: () => { },
        clearPatient: () => { },
        clearAllBeds: () => { },
        moveOrCopyPatient: () => { },
        toggleBlockBed: () => { },
        updateBlockedReason: () => { },
        toggleExtraBed: () => { },
        updateNurse: () => { },
        updateTens: () => { },
        addDischarge: () => { },
        updateDischarge: () => { },
        deleteDischarge: () => { },
        undoDischarge: () => { },
        addTransfer: () => { },
        updateTransfer: () => { },
        deleteTransfer: () => { },
        undoTransfer: () => { },
        addCMA: () => { },
        deleteCMA: () => { },
        updateCMA: () => { },
        updateHandoffChecklist: () => { },
        updateHandoffNovedades: () => { },
        updateHandoffStaff: () => { },
        updateMedicalSignature: async () => { },
        updateMedicalHandoffDoctor: async () => { },
        markMedicalHandoffAsSent: async () => { },
        sendMedicalHandoff: async () => { },
        ...overrides,
    };
};
