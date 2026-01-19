/**
 * Statistics Calculator
 * Calculates hospital census statistics from bed data.
 */

import { PatientData } from '../../types';
import { BEDS, HOSPITAL_CAPACITY } from '../../constants';

/**
 * Census Statistics Result
 * 
 * @interface CensusStatistics
 * @property {number} occupiedBeds - Main patients (Bed or Cuna mode)
 * @property {number} occupiedCribs - Nested patients only (internal count)
 * @property {number} clinicalCribsCount - Display count: Main(Cuna) + Nested
 * @property {number} companionCribs - RN Sano (healthy newborn) count
 * @property {number} totalCribsUsed - Physical crib resources being used
 * @property {number} totalHospitalized - Total patient count (main + nested)
 * @property {number} blockedBeds - Number of blocked/unavailable beds
 * @property {number} serviceCapacity - Total hospital bed capacity
 * @property {number} availableCapacity - Capacity minus blocked beds
 */
export interface CensusStatistics {
    occupiedBeds: number;         // Main patients (Bed or Cuna mode)
    occupiedCribs: number;        // Nested patients only (internal)
    clinicalCribsCount: number;   // Display: Main(Cuna) + Nested
    companionCribs: number;       // RN Sano count
    totalCribsUsed: number;       // Physical crib count
    totalHospitalized: number;    // Total patients
    blockedBeds: number;          // Blocked beds
    serviceCapacity: number;      // Hospital capacity
    availableCapacity: number;    // Capacity minus blocked
}

/**
 * Calculate comprehensive census statistics from bed data
 * 
 * This function analyzes all beds and computes:
 * - Occupied beds and cribs
 * - Clinical vs companion cribs
 * - Total physical crib usage
 * - Available capacity
 * 
 * @param {Record<string, PatientData>} beds - Object mapping bed IDs to patient data
 * @returns {CensusStatistics} Computed statistics object
 * 
 * @example
 * ```typescript
 * const stats = calculateStats(record.beds);
    // console.debug(stats.totalHospitalized); // Total patient count
    // console.debug(stats.availableCapacity); // Available beds
 * ```
 */
export const calculateStats = (beds: Record<string, PatientData>): CensusStatistics => {
    let occupiedBeds = 0;
    let occupiedCribs = 0;
    let blockedBeds = 0;
    let companionCribs = 0;
    let resourceCribs = 0;
    let clinicalCribsCount = 0;

    BEDS.forEach(bed => {
        const data = beds[bed.id];
        if (!data) return;

        if (data.isBlocked) {
            blockedBeds++;
        } else {
            const isMainOccupied = data.patientName && data.patientName.trim() !== '';

            // 1. Occupied Bed (Main slot has patient)
            if (isMainOccupied) {
                occupiedBeds++;
            }

            // 2. Nested Occupied Cribs (Clinical crib sub-patients)
            if (data.clinicalCrib?.patientName?.trim()) {
                occupiedCribs++;
            }

            // --- CRIB STATS ---

            // A) Main is Cuna Mode & Occupied -> Clinical Crib patient
            if (isMainOccupied && data.bedMode === 'Cuna') {
                clinicalCribsCount++;
                resourceCribs++;
            }

            // B) Clinical Crib (Nested) Exists -> Clinical Crib patient
            if (data.clinicalCrib?.patientName) {
                clinicalCribsCount++;
                resourceCribs++;
            }

            // C) Main is Cuna Mode but Empty -> Uses crib resource
            if (!isMainOccupied && data.bedMode === 'Cuna') {
                resourceCribs++;
            }

            // D) Companion Crib (RN Sano)
            if (data.hasCompanionCrib) {
                companionCribs++;
                resourceCribs++;
            }
        }
    });

    return {
        occupiedBeds,
        occupiedCribs,
        clinicalCribsCount,
        companionCribs,
        totalCribsUsed: resourceCribs,
        totalHospitalized: occupiedBeds + occupiedCribs,
        blockedBeds,
        serviceCapacity: HOSPITAL_CAPACITY,
        // Camas Libres = Total - Bloqueadas - Ocupadas
        availableCapacity: HOSPITAL_CAPACITY - blockedBeds - occupiedBeds,
    };
};
