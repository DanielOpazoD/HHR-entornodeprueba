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
export const EVACUATION_METHODS = [
    'Avión comercial',
    'Aerocardal',
    'Avión FACH',
    'Otro'
] as const;
export type EvacuationMethod = typeof EVACUATION_METHODS[number];
export const DEFAULT_EVACUATION_METHOD: EvacuationMethod = EVACUATION_METHODS[0];
export const EVACUATION_METHOD_AEROCARDAL: EvacuationMethod = 'Aerocardal';
export const EVACUATION_METHOD_COMMERCIAL: EvacuationMethod = 'Avión comercial';
export const EVACUATION_METHOD_OTHER: EvacuationMethod = 'Otro';

// Receiving Centers for Transfers
export const RECEIVING_CENTERS = [
    'Hospital Salvador',
    'Instituto Nacional del Tórax',
    'Hospital Tisné',
    'Hospital Dr. Luis Calvo Mackenna',
    'Hospital Horwitz',
    'Extrasistema',
    'Otro'
] as const;
export type ReceivingCenter = typeof RECEIVING_CENTERS[number];
export const DEFAULT_RECEIVING_CENTER: ReceivingCenter = RECEIVING_CENTERS[0];
export const RECEIVING_CENTER_OTHER: ReceivingCenter = 'Otro';
export const RECEIVING_CENTER_EXTRASYSTEM: ReceivingCenter = 'Extrasistema';

// Discharges
export const DISCHARGE_STATUSES = ['Vivo', 'Fallecido'] as const;
export type DischargeStatus = typeof DISCHARGE_STATUSES[number];
export const DEFAULT_DISCHARGE_STATUS: DischargeStatus = DISCHARGE_STATUSES[0];

export const DISCHARGE_TYPES = ['Domicilio (Habitual)', 'Voluntaria', 'Fuga', 'Otra'] as const;
export type DischargeType = typeof DISCHARGE_TYPES[number];
export const DEFAULT_DISCHARGE_TYPE: DischargeType = DISCHARGE_TYPES[0];
export const DISCHARGE_TYPE_OTHER: DischargeType = 'Otra';

// Transfer Escorts
export const TRANSFER_ESCORT_OPTIONS = ['Enfermera', 'TENS', 'Matrona'] as const;
export type TransferEscortOption = typeof TRANSFER_ESCORT_OPTIONS[number];
export const DEFAULT_TRANSFER_ESCORT: TransferEscortOption = TRANSFER_ESCORT_OPTIONS[0];

export const isTransferEscortOption = (value: string): value is TransferEscortOption =>
    (TRANSFER_ESCORT_OPTIONS as readonly string[]).includes(value);

export const isEvacuationMethod = (value: string): value is EvacuationMethod =>
    (EVACUATION_METHODS as readonly string[]).includes(value);

export const isReceivingCenter = (value: string): value is ReceivingCenter =>
    (RECEIVING_CENTERS as readonly string[]).includes(value);

export const normalizeEvacuationMethod = (value?: string): EvacuationMethod =>
    value && isEvacuationMethod(value) ? value : DEFAULT_EVACUATION_METHOD;

export const normalizeReceivingCenter = (value?: string): ReceivingCenter =>
    value && isReceivingCenter(value) ? value : DEFAULT_RECEIVING_CENTER;
