/**
 * Transfer Management Constants
 * Configuration for the patient transfer workflow
 */

import { TransferStatus } from '../types/transfers';

// ============================================================================
// Status Flow
// ============================================================================

/**
 * Allowed status transitions
 */
export const STATUS_TRANSITIONS: Record<TransferStatus, TransferStatus | null> = {
    REQUESTED: 'SENT',
    SENT: 'ACCEPTED',
    ACCEPTED: 'TRANSFERRED',
    TRANSFERRED: 'RECEIVED',
    RECEIVED: null,
    CANCELLED: null
};

/**
 * Get next available status
 */
export const getNextStatus = (current: TransferStatus): TransferStatus | null => {
    return STATUS_TRANSITIONS[current];
};

// ============================================================================
// Hospital Destinations
// ============================================================================

/**
 * Common destination hospitals
 * TODO: Load from Firestore settings for dynamic configuration
 */
export const DESTINATION_HOSPITALS = [
    { id: 'van_buren', name: 'Hospital Carlos Van Buren', city: 'Valparaíso' },
    { id: 'san_jose', name: 'Hospital San José', city: 'Santiago' },
    { id: 'san_borja', name: 'Hospital San Borja Arriarán', city: 'Santiago' },
    { id: 'salvador', name: 'Hospital del Salvador', city: 'Santiago' },
    { id: 'felix_bulnes', name: 'Hospital Félix Bulnes', city: 'Santiago' },
    { id: 'sotero_del_rio', name: 'Hospital Sótero del Río', city: 'Santiago' },
    { id: 'otro', name: 'Otro', city: '' }
] as const;

// ============================================================================
// Medical Specialties
// ============================================================================

/**
 * Common specialties for transfer requests
 */
export const MEDICAL_SPECIALTIES = [
    'Medicina Interna',
    'Cirugía General',
    'Traumatología',
    'Cardiología',
    'Neurología',
    'Nefrología',
    'UCI/UPC',
    'Pediatría',
    'Ginecobstetricia',
    'Oncología',
    'Otra'
] as const;

// ============================================================================
// Transfer Reasons
// ============================================================================

/**
 * Common reasons for patient transfer
 */
export const TRANSFER_REASONS = [
    'Complejidad clínica requiere nivel superior',
    'Necesidad de especialista no disponible',
    'Requiere procedimiento quirúrgico especializado',
    'Requiere UCI/UPC',
    'Estudio diagnóstico avanzado',
    'Cercanía a domicilio familiar',
    'Otro'
] as const;

// ============================================================================
// Days Calculation
// ============================================================================

/**
 * Calculate days elapsed since request date
 */
export const calculateDaysElapsed = (requestDate: string): number => {
    const start = new Date(requestDate);
    const now = new Date();
    const diffTime = Math.abs(now.getTime() - start.getTime());
    return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
};
