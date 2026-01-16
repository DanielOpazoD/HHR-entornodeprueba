/**
 * Patient Defaults
 * Default/empty patient data structure
 */

import { PatientData, Specialty, PatientStatus } from '../types';

export const EMPTY_PATIENT: Omit<PatientData, 'bedId'> = {
    isBlocked: false,
    blockedReason: '',
    bedMode: 'Cama',
    hasCompanionCrib: false,
    clinicalCrib: undefined,
    patientName: '',
    rut: '',
    documentType: 'RUT',
    age: '',
    birthDate: '',
    biologicalSex: 'Indeterminado',
    insurance: undefined,
    admissionOrigin: undefined,
    admissionOriginDetails: '',
    origin: undefined,
    isRapanui: false,
    pathology: '',
    specialty: Specialty.EMPTY,
    status: PatientStatus.EMPTY,
    admissionDate: '',
    admissionTime: '',
    hasWristband: true,
    devices: [],
    surgicalComplication: false,
    isUPC: false,
    location: '',
    clinicalEvents: []
};
