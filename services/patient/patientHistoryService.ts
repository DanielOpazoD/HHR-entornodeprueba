/**
 * Patient History Service
 * 
 * Retrieves the movement history of a patient across all daily records.
 * Searches by RUT to find all beds, discharges, and transfers.
 */

import { DailyRecord } from '../../types';
import { getAllRecords } from '../storage/indexedDBService';
import { BEDS } from '../../constants';

// ============================================================================
// Types
// ============================================================================

export type MovementType = 'admission' | 'stay' | 'internal_move' | 'discharge' | 'transfer';

export interface PatientMovement {
    date: string;
    bedId: string;
    bedName: string;
    bedType: string;
    type: MovementType;
    details?: string;
    time?: string;
}

export interface PatientHistoryResult {
    patientName: string;
    rut: string;
    movements: PatientMovement[];
    totalDays: number;
    firstSeen: string;
    lastSeen: string;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Get bed name from bed ID
 */
function getBedName(bedId: string): string {
    const bed = BEDS.find(b => b.id === bedId);
    return bed?.name || bedId;
}

/**
 * Get bed type from bed ID
 */
function getBedType(bedId: string): string {
    const bed = BEDS.find(b => b.id === bedId);
    return bed?.type || 'MEDIA';
}

/**
 * Normalize RUT for comparison (removes dots, dashes, leading zeros)
 */
function normalizeRut(rut: string): string {
    if (!rut) return '';
    return rut.replace(/[.\-\s]/g, '').toLowerCase().replace(/^0+/, '');
}

// ============================================================================
// Main Service Function
// ============================================================================

/**
 * Retrieves the complete movement history of a patient by RUT.
 * 
 * @param rut - Patient's RUT to search for
 * @returns PatientHistoryResult with all movements, or null if not found
 */
export async function getPatientMovementHistory(rut: string): Promise<PatientHistoryResult | null> {
    if (!rut || rut.trim().length < 3) return null;

    const normalizedRut = normalizeRut(rut);
    const allRecords = await getAllRecords();

    // Sort records by date (oldest first for timeline)
    const sortedDates = Object.keys(allRecords).sort();

    const movements: PatientMovement[] = [];
    let patientName = '';
    let previousBedId: string | null = null;

    for (const date of sortedDates) {
        const record: DailyRecord = allRecords[date];

        // 1. Check active beds
        for (const bedId of Object.keys(record.beds)) {
            const patient = record.beds[bedId];
            if (!patient.rut) continue;

            if (normalizeRut(patient.rut) === normalizedRut) {
                // Found patient in this bed on this date
                if (!patientName && patient.patientName) {
                    patientName = patient.patientName;
                }

                if (previousBedId === null) {
                    // First time seeing this patient - it's an admission
                    movements.push({
                        date,
                        bedId,
                        bedName: getBedName(bedId),
                        bedType: getBedType(bedId),
                        type: 'admission',
                        details: patient.admissionOrigin || undefined,
                        time: patient.admissionTime
                    });
                } else if (previousBedId !== bedId) {
                    // Patient moved to a different bed
                    movements.push({
                        date,
                        bedId,
                        bedName: getBedName(bedId),
                        bedType: getBedType(bedId),
                        type: 'internal_move',
                        details: `Desde cama ${getBedName(previousBedId)}`
                    });
                }
                // If same bed as before, it's just a "stay" - no need to log

                previousBedId = bedId;
            }

            // Also check clinical crib (nested patient)
            if (patient.clinicalCrib?.rut && normalizeRut(patient.clinicalCrib.rut) === normalizedRut) {
                if (!patientName && patient.clinicalCrib.patientName) {
                    patientName = patient.clinicalCrib.patientName;
                }

                const cribBedId: string = `${bedId}-cuna`;
                if (previousBedId !== cribBedId) {
                    movements.push({
                        date,
                        bedId: cribBedId,
                        bedName: `Cuna (${getBedName(bedId)})`,
                        bedType: 'CUNA',
                        type: previousBedId === null ? 'admission' : 'internal_move'
                    });
                    previousBedId = cribBedId;
                }
            }
        }

        // 2. Check discharges
        for (const discharge of record.discharges || []) {
            if (normalizeRut(discharge.rut) === normalizedRut) {
                if (!patientName && discharge.patientName) {
                    patientName = discharge.patientName;
                }

                movements.push({
                    date,
                    bedId: discharge.bedId,
                    bedName: discharge.bedName,
                    bedType: discharge.bedType,
                    type: 'discharge',
                    details: discharge.status === 'Fallecido' ? 'Fallecimiento' : discharge.dischargeType,
                    time: discharge.time
                });

                // Patient left, reset tracking
                previousBedId = null;
            }
        }

        // 3. Check transfers
        for (const transfer of record.transfers || []) {
            if (normalizeRut(transfer.rut) === normalizedRut) {
                if (!patientName && transfer.patientName) {
                    patientName = transfer.patientName;
                }

                movements.push({
                    date,
                    bedId: transfer.bedId,
                    bedName: transfer.bedName,
                    bedType: transfer.bedType,
                    type: 'transfer',
                    details: `${transfer.evacuationMethod} → ${transfer.receivingCenter}`,
                    time: transfer.time
                });

                // Patient left, reset tracking
                previousBedId = null;
            }
        }
    }

    if (movements.length === 0) {
        return null;
    }

    // Calculate summary stats
    const uniqueDates = new Set(movements.map(m => m.date));

    return {
        patientName: patientName || 'Paciente',
        rut,
        movements,
        totalDays: uniqueDates.size,
        firstSeen: movements[0].date,
        lastSeen: movements[movements.length - 1].date
    };
}
