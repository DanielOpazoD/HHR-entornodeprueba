/**
 * Clinical Constants
 * Medical devices, specialties, statuses, and clinical options
 */

import { Specialty, PatientStatus } from '@/types';

// Specialty and Status Options (filtered)
export const SPECIALTY_OPTIONS = Object.values(Specialty).filter(s => s !== '');
export const STATUS_OPTIONS = Object.values(PatientStatus).filter(s => s !== '');

export const SPECIALTY_ABBREVIATIONS: Record<string, string> = {
    [Specialty.MEDICINA]: 'MI',
    [Specialty.CIRUGIA]: 'Cir',
    [Specialty.TRAUMATOLOGIA]: 'TMT',
    [Specialty.GINECOBSTETRICIA]: 'Gyn',
    [Specialty.PSIQUIATRIA]: 'PSQ',
    [Specialty.PEDIATRIA]: 'Ped',
    [Specialty.ODONTOLOGIA]: 'Odo',
    [Specialty.OTRO]: 'Otro'
};

// Admission Origins
export const ADMISSION_ORIGIN_OPTIONS: string[] = ['CAE', 'APS', 'Urgencias', 'Pabellón', 'Otro'];
export type AdmissionOrigin = 'CAE' | 'APS' | 'Urgencias' | 'Pabellón' | 'Otro';

// Medical Devices
export const VVP_DEVICE_KEYS = ['VVP#1', 'VVP#2', 'VVP#3'] as const;
export const DEVICE_OPTIONS: string[] = ['CVC', 'LA', 'CUP', 'TET', 'SNG'];
export type DeviceType = typeof DEVICE_OPTIONS[number] | typeof VVP_DEVICE_KEYS[number];

// Evacuation/Transfer Methods
export const EVACUATION_METHODS: string[] = [
    'Avión comercial',
    'Aerocardal',
    'Avión FACH',
    'Otro'
];
export type EvacuationMethod = 'Avión comercial' | 'Aerocardal' | 'Avión FACH' | 'Otro';

// Receiving Centers for Transfers
export const RECEIVING_CENTERS: string[] = [
    'Hospital Salvador',
    'Instituto Nacional del Tórax',
    'Hospital Tisné',
    'Hospital Dr. Luis Calvo Mackenna',
    'Hospital Horwitz',
    'Extrasistema',
    'Otro'
];
export type ReceivingCenter = 'Hospital Salvador' | 'Instituto Nacional del Tórax' | 'Hospital Tisné' | 'Hospital Dr. Luis Calvo Mackenna' | 'Hospital Horwitz' | 'Extrasistema' | 'Otro';
