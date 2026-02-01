/**
 * Patient History Service
 * 
 * Retrieves the movement history of a patient across all daily records.
 * Searches by RUT to find all beds, discharges, and transfers.
 */

import { DailyRecord } from '@/types';
import { getAllRecords } from '../storage/indexedDBService';
import { BEDS } from '@/constants';

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
    let admissionDate = '';
    let lastSeenDate = '';

    // We process records to find movements and the latest admission date
    for (const date of sortedDates) {
        const record: DailyRecord = allRecords[date];

        // 1. Check active beds
        for (const bedId of Object.keys(record.beds)) {
            const patient = record.beds[bedId];
            if (!patient.rut) continue;

            if (normalizeRut(patient.rut) === normalizedRut) {
                if (!patientName && patient.patientName) patientName = patient.patientName;
                if (patient.admissionDate) admissionDate = patient.admissionDate;
                lastSeenDate = date;

                // Movements logic...
                // To keep it simple and accurate, we detect transitions
                const currentMove: PatientMovement = {
                    date,
                    bedId,
                    bedName: getBedName(bedId),
                    bedType: getBedType(bedId),
                    type: 'stay', // Default
                    details: patient.admissionOrigin || undefined,
                    time: patient.admissionTime
                };

                // Identify if it's the first time or a change
                const lastMove = movements[movements.length - 1];
                if (!lastMove) {
                    currentMove.type = 'admission';
                    movements.push(currentMove);
                } else if (lastMove.bedId !== bedId) {
                    currentMove.type = 'internal_move';
                    currentMove.details = `Desde cama ${lastMove.bedName}`;
                    movements.push(currentMove);
                }
            }

            // Check clinical crib
            if (patient.clinicalCrib?.rut && normalizeRut(patient.clinicalCrib.rut) === normalizedRut) {
                if (!patientName && patient.clinicalCrib.patientName) patientName = patient.clinicalCrib.patientName;
                if (patient.clinicalCrib.admissionDate) admissionDate = patient.clinicalCrib.admissionDate;
                lastSeenDate = date;

                const cribBedId = `${bedId}-cuna`;
                const lastMove = movements[movements.length - 1];

                if (!lastMove) {
                    movements.push({
                        date,
                        bedId: cribBedId,
                        bedName: `Cuna (${getBedName(bedId)})`,
                        bedType: 'CUNA',
                        type: 'admission'
                    });
                } else if (lastMove.bedId !== cribBedId) {
                    movements.push({
                        date,
                        bedId: cribBedId,
                        bedName: `Cuna (${getBedName(bedId)})`,
                        bedType: 'CUNA',
                        type: 'internal_move',
                        details: `Desde cama ${lastMove.bedName}`
                    });
                }
            }
        }

        // 2. Check discharges/transfers (these end a session)
        for (const discharge of record.discharges || []) {
            if (normalizeRut(discharge.rut) === normalizedRut) {
                lastSeenDate = date;
                movements.push({
                    date,
                    bedId: discharge.bedId,
                    bedName: discharge.bedName,
                    bedType: discharge.bedType,
                    type: 'discharge',
                    details: discharge.status === 'Fallecido' ? 'Fallecimiento' : discharge.dischargeType,
                    time: discharge.time
                });
            }
        }

        for (const transfer of record.transfers || []) {
            if (normalizeRut(transfer.rut) === normalizedRut) {
                lastSeenDate = date;
                movements.push({
                    date,
                    bedId: transfer.bedId,
                    bedName: transfer.bedName,
                    bedType: transfer.bedType,
                    type: 'transfer',
                    details: `${transfer.evacuationMethod} → ${transfer.receivingCenter}`,
                    time: transfer.time
                });
            }
        }
    }

    if (movements.length === 0) return null;

    // Use the official formula for totalDays (matching Census first column)
    const calculateDays = (startStr: string, endStr: string): number => {
        if (!startStr || !endStr) return 0;
        const start = new Date(`${startStr}T12:00:00`);
        const end = new Date(`${endStr}T12:00:00`);
        const diff = end.getTime() - start.getTime();
        const days = Math.round(diff / (1000 * 3600 * 24));
        return days >= 0 ? days : 0;
    };

    const totalDays = calculateDays(admissionDate, lastSeenDate);

    // Filter movements to only include those in the current hospitalization (on or after admissionDate)
    const currentSessionMovements = movements.filter(m => m.date >= (admissionDate || '0000-00-00'));

    return {
        patientName: patientName || 'Paciente',
        rut,
        movements: currentSessionMovements,
        totalDays,
        firstSeen: admissionDate || movements[0].date,
        lastSeen: lastSeenDate
    };
}
