import {
    DailyRecord,
    PatientData,
    CudyrScore,
    DischargeData,
    TransferData,
    CMAData,
    Specialty,
    PatientStatus,
    ClinicalEvent,
    Statistics,
    MasterPatient
} from '@/types';
import { BEDS } from '@/constants';
import { createEmptyPatient } from '@/services/factories/patientFactory';

/**
 * DataFactory for Testing
 * Provides consistent, typed generators for mock domain objects.
 * Reduces the need for 'any' casts and boilerplate in test suites.
 */
export const DataFactory = {
    /**
     * Creates a mock CUDYR score object
     */
    createMockCudyr: (overrides?: Partial<CudyrScore>): CudyrScore => ({
        changeClothes: 0,
        mobilization: 0,
        feeding: 0,
        elimination: 0,
        psychosocial: 0,
        surveillance: 0,
        vitalSigns: 0,
        fluidBalance: 0,
        oxygenTherapy: 0,
        airway: 0,
        proInterventions: 0,
        skinCare: 0,
        pharmacology: 0,
        invasiveElements: 0,
        ...overrides
    }),

    /**
     * Creates a mock patient with defaults
     */
    createMockPatient: (bedId: string = 'bed1', overrides?: Partial<PatientData>): PatientData => {
        const base = createEmptyPatient(bedId);
        return {
            ...base,
            patientName: 'John Doe',
            rut: '12345678-9',
            age: '45',
            specialty: Specialty.MEDICINA,
            status: PatientStatus.ESTABLE,
            admissionDate: new Date().toISOString().split('T')[0],
            hasWristband: true,
            isUPC: false,
            surgicalComplication: false,
            ...overrides
        };
    },

    /**
     * Creates a mock DailyRecord
     */
    createMockDailyRecord: (date: string, overrides?: Partial<DailyRecord>): DailyRecord => ({
        date,
        beds: BEDS.reduce((acc, bed) => {
            acc[bed.id] = createEmptyPatient(bed.id);
            return acc;
        }, {} as Record<string, PatientData>),
        discharges: [],
        transfers: [],
        cma: [],
        nurses: [],
        nursesDayShift: [],
        nursesNightShift: [],
        tensDayShift: [],
        tensNightShift: [],
        activeExtraBeds: [],
        lastUpdated: new Date().toISOString(),
        ...overrides
    }),

    /**
     * Creates a mock Discharge entry
     */
    createMockDischarge: (overrides?: Partial<DischargeData>): DischargeData => ({
        id: `disc-${Math.random().toString(36).substring(2, 11)}`,
        patientName: 'Discharged Patient',
        rut: '98765432-1',
        bedId: 'bed1',
        bedName: 'Cama 1',
        bedType: 'UTI',
        diagnosis: 'Diagnosis',
        time: '12:00',
        status: 'Vivo',
        ...overrides
    }),

    /**
     * Creates a mock Transfer entry
     */
    createMockTransfer: (overrides?: Partial<TransferData>): TransferData => ({
        id: `trans-${Math.random().toString(36).substring(2, 11)}`,
        patientName: 'Transferred Patient',
        rut: '11223344-5',
        bedId: 'bed1',
        bedName: 'Cama 1',
        bedType: 'UTI',
        diagnosis: 'Diagnosis',
        time: '12:00',
        evacuationMethod: 'Ambulancia',
        receivingCenter: 'Hospital Regional',
        ...overrides
    }),

    /**
     * Creates a mock CMA entry
     */
    createMockCMA: (overrides?: Partial<CMAData>): CMAData => ({
        id: `cma-${Math.random().toString(36).substring(2, 11)}`,
        bedName: 'CMA 1',
        patientName: 'CMA Patient',
        rut: '55667788-9',
        age: '30',
        diagnosis: 'Minor Surgery',
        specialty: 'Cirugía',
        interventionType: 'Cirugía Mayor Ambulatoria',
        ...overrides
    }),

    /**
     * Creates a mock ClinicalEvent
     */
    createMockClinicalEvent: (overrides?: Partial<ClinicalEvent>): ClinicalEvent => ({
        id: `event-${Math.random().toString(36).substring(2, 11)}`,
        name: 'Mock Procedure',
        date: new Date().toISOString(),
        createdAt: new Date().toISOString(),
        ...overrides
    }),

    /**
     * Creates mock Statistics
     */
    createMockStatistics: (overrides?: Partial<Statistics>): Statistics => ({
        occupiedBeds: 10,
        occupiedCribs: 2,
        clinicalCribsCount: 3,
        companionCribs: 1,
        totalCribsUsed: 3,
        totalHospitalized: 12,
        blockedBeds: 1,
        serviceCapacity: 17,
        availableCapacity: 7,
        ...overrides
    }),

    /**
     * Creates a mock MasterPatient record
     */
    createMockMasterPatient: (rut: string = '12345678-9', overrides?: Partial<MasterPatient>): MasterPatient => ({
        rut,
        fullName: 'John Doe Master',
        birthDate: '1980-01-01',
        gender: 'Masculino',
        vitalStatus: 'Vivo',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        hospitalizations: [],
        ...overrides
    })
};
