import type { ClinicalEvent } from '@/types/domain/clinicalEvents';
import type { CudyrScore } from '@/types/domain/cudyr';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { DischargeData, TransferData, CMAData } from '@/types/domain/movements';
import type { PatientData } from '@/types/domain/patient';
import { Specialty, PatientStatus } from '@/types/domain/patientClassification';
import type { MasterPatient } from '@/types/domain/patientMaster';
import type { Statistics } from '@/types/domain/statistics';
import { BEDS } from '@/constants/beds';
import { createEmptyPatient } from '@/services/factories/patientFactory';

const FIXED_ISO_TIMESTAMP = '2026-01-01T00:00:00.000Z';
const FIXED_DATE = '2026-01-01';
const FIXED_EPOCH_MS = 1767225600000;
let idSequence = 0;

const nextMockId = (prefix: string): string => {
  idSequence += 1;
  return `${prefix}-${String(idSequence).padStart(4, '0')}`;
};

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
    ...overrides,
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
      admissionDate: FIXED_DATE,
      hasWristband: true,
      isUPC: false,
      surgicalComplication: false,
      ...overrides,
    };
  },

  /**
   * Creates a mock DailyRecord
   */
  createMockDailyRecord: (date: string, overrides?: Partial<DailyRecord>): DailyRecord => ({
    date,
    beds: BEDS.reduce(
      (acc, bed) => {
        acc[bed.id] = createEmptyPatient(bed.id);
        return acc;
      },
      {} as Record<string, PatientData>
    ),
    discharges: [],
    transfers: [],
    cma: [],
    nurses: [],
    nursesDayShift: [],
    nursesNightShift: [],
    tensDayShift: [],
    tensNightShift: [],
    activeExtraBeds: [],
    lastUpdated: FIXED_ISO_TIMESTAMP,
    ...overrides,
  }),

  /**
   * Creates a mock Discharge entry
   */
  createMockDischarge: (overrides?: Partial<DischargeData>): DischargeData => ({
    id: nextMockId('disc'),
    patientName: 'Discharged Patient',
    rut: '98765432-1',
    bedId: 'bed1',
    bedName: 'Cama 1',
    bedType: 'UTI',
    diagnosis: 'Diagnosis',
    time: '12:00',
    status: 'Vivo',
    ...overrides,
  }),

  /**
   * Creates a mock Transfer entry
   */
  createMockTransfer: (overrides?: Partial<TransferData>): TransferData => ({
    id: nextMockId('trans'),
    patientName: 'Transferred Patient',
    rut: '11223344-5',
    bedId: 'bed1',
    bedName: 'Cama 1',
    bedType: 'UTI',
    diagnosis: 'Diagnosis',
    time: '12:00',
    evacuationMethod: 'Ambulancia',
    receivingCenter: 'Hospital Regional',
    ...overrides,
  }),

  /**
   * Creates a mock CMA entry
   */
  createMockCMA: (overrides?: Partial<CMAData>): CMAData => ({
    id: nextMockId('cma'),
    bedName: 'CMA 1',
    patientName: 'CMA Patient',
    rut: '55667788-9',
    age: '30',
    diagnosis: 'Minor Surgery',
    specialty: 'Cirugía',
    interventionType: 'Cirugía Mayor Ambulatoria',
    ...overrides,
  }),

  /**
   * Creates a mock ClinicalEvent
   */
  createMockClinicalEvent: (overrides?: Partial<ClinicalEvent>): ClinicalEvent => ({
    id: nextMockId('event'),
    name: 'Mock Procedure',
    date: FIXED_ISO_TIMESTAMP,
    createdAt: FIXED_ISO_TIMESTAMP,
    ...overrides,
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
    ...overrides,
  }),

  /**
   * Creates a mock MasterPatient record
   */
  createMockMasterPatient: (
    rut: string = '12345678-9',
    overrides?: Partial<MasterPatient>
  ): MasterPatient => ({
    rut,
    fullName: 'John Doe Master',
    birthDate: '1980-01-01',
    gender: 'Masculino',
    vitalStatus: 'Vivo',
    createdAt: FIXED_EPOCH_MS,
    updatedAt: FIXED_EPOCH_MS,
    hospitalizations: [],
    ...overrides,
  }),
};

/**
 * A day, or part of one, kept exactly as written: a shape the current `DailyRecord` type does not
 * describe (a missing field, a malformed value, an old stored document) or one the factory would
 * change by adding fields the test must not see. Use `DataFactory.createMockDailyRecord` for
 * everything else, so a change to the type breaks the test at compile time.
 */
export const asStoredDailyRecordShape = <T = DailyRecord>(shape: unknown): T => shape as T;
