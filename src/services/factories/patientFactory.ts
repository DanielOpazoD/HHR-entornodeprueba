/**
 * Patient Factory
 * Creates new patient data objects with proper defaults.
 */

import { PatientData } from '@/services/contracts/patientServiceContracts';
import { BEDS } from '@/constants/beds';
import { EMPTY_PATIENT } from '@/constants/patient';
import { deepClone } from '@/utils/deepClone';

/**
 * Create an empty patient data object with proper defaults based on bed configuration.
 * @param bedId - The bed ID to create patient data for
 * @returns New PatientData object with defaults
 */
export const createEmptyPatient = (bedId: string): PatientData => {
  // Determine default mode based on static definition (NEO beds default to Cuna)
  const bedDef = BEDS.find(b => b.id === bedId);
  const defaultMode = bedDef?.isCuna ? 'Cuna' : 'Cama';

  return {
    ...EMPTY_PATIENT,
    devices: [], // New array reference to prevent mutations
    bedId: bedId,
    bedMode: defaultMode,
    hasCompanionCrib: false,
    clinicalCrib: undefined,
    insurance: undefined,
    origin: undefined,
    admissionOrigin: undefined,
    admissionOriginDetails: '',
    documentType: 'RUT',
    handoffNote: '',
    handoffNoteDayShift: '',
    handoffNoteNightShift: '',
    medicalHandoffNote: '',
    medicalHandoffAudit: undefined,
    medicalHandoffEntries: [],
    clinicalEvents: [],
    firstSeenDate: undefined,
    ginecobstetriciaType: undefined,
    secondarySpecialty: undefined,
    deliveryRoute: undefined,
    deliveryDate: undefined,
    deliveryCesareanLabor: undefined,
  };
};

/**
 * Deep copy a patient data object to prevent reference issues
 */
export const clonePatient = (patient: PatientData): PatientData => {
  return deepClone(patient);
};
