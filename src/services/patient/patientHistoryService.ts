/**
 * Patient History Service
 *
 * Retrieves the movement history of a patient across all daily records.
 * Searches by RUT to find all beds, discharges, and transfers.
 */

import {
  loadPatientHistoryRecords,
  type PatientHistoryRecord,
  type PatientHistoryLoadOptions,
} from './patientHistoryRecordLoader';
export type { PatientHistoryLoadOptions } from './patientHistoryRecordLoader';
import { BEDS } from '@/constants/beds';
import { getActiveMovements } from '@/application/census/movementTombstonePolicy';

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
  return rut
    .replace(/[.\-\s]/g, '')
    .toLowerCase()
    .replace(/^0+/, '');
}

export interface PatientHistoryReadResult {
  history: PatientHistoryResult | null;
  source: 'server' | 'local' | 'local-only';
}

export async function getPatientMovementHistoryDetailed(
  rut: string,
  options?: PatientHistoryLoadOptions
): Promise<PatientHistoryReadResult> {
  if (!rut || rut.trim().length < 3) throw new Error('Invalid patient identifier');
  const { records, source } = await loadPatientHistoryRecords(options);
  return { history: collectPatientMovementHistory(rut, records), source };
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
export async function getPatientMovementHistory(
  rut: string,
  options?: PatientHistoryLoadOptions
): Promise<PatientHistoryResult | null> {
  if (!rut || rut.trim().length < 3) return null;

  return (await getPatientMovementHistoryDetailed(rut, options)).history;
}

function collectPatientMovementHistory(
  rut: string,
  records: PatientHistoryRecord[]
): PatientHistoryResult | null {
  const normalizedRut = normalizeRut(rut);
  const allRecords = Object.fromEntries(records.map(record => [record.date, record]));

  // Sort records by date (oldest first for timeline)
  const sortedDates = Object.keys(allRecords).sort();

  const movements: PatientMovement[] = [];
  let patientName = '';
  let lastSeenDate = '';
  let openEpisodeAdmissionDate = '';
  let isEpisodeOpen = false;

  // We process records to find movements and the latest admission date
  for (const date of sortedDates) {
    const record: PatientHistoryRecord = allRecords[date];

    // 1. Check active beds
    for (const bedId of Object.keys(record.beds)) {
      const patient = record.beds[bedId];
      if (!patient.rut) continue;

      if (normalizeRut(patient.rut) === normalizedRut) {
        if (!patientName && patient.patientName) patientName = patient.patientName;
        const patientAdmissionDate = patient.admissionDate || date;
        if (patientAdmissionDate) openEpisodeAdmissionDate ||= patientAdmissionDate;
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
          time: patient.admissionTime,
        };

        // Identify if it's the first time, a new admission, or a bed change.
        const lastMove = movements[movements.length - 1];
        if (
          !lastMove ||
          !isEpisodeOpen ||
          (openEpisodeAdmissionDate && patientAdmissionDate !== openEpisodeAdmissionDate)
        ) {
          currentMove.type = 'admission';
          movements.push(currentMove);
          openEpisodeAdmissionDate = patientAdmissionDate;
          isEpisodeOpen = true;
        } else if (lastMove.bedId !== bedId) {
          currentMove.type = 'internal_move';
          currentMove.details = `Desde cama ${lastMove.bedName}`;
          movements.push(currentMove);
        }
      }

      // Check clinical crib
      if (patient.clinicalCrib?.rut && normalizeRut(patient.clinicalCrib.rut) === normalizedRut) {
        if (!patientName && patient.clinicalCrib.patientName)
          patientName = patient.clinicalCrib.patientName;
        const cribAdmissionDate = patient.clinicalCrib.admissionDate || date;
        if (cribAdmissionDate) openEpisodeAdmissionDate ||= cribAdmissionDate;
        lastSeenDate = date;

        const cribBedId = `${bedId}-cuna`;
        const lastMove = movements[movements.length - 1];

        if (
          !lastMove ||
          !isEpisodeOpen ||
          (openEpisodeAdmissionDate && cribAdmissionDate !== openEpisodeAdmissionDate)
        ) {
          movements.push({
            date,
            bedId: cribBedId,
            bedName: `Cuna (${getBedName(bedId)})`,
            bedType: 'CUNA',
            type: 'admission',
          });
          openEpisodeAdmissionDate = cribAdmissionDate;
          isEpisodeOpen = true;
        } else if (lastMove.bedId !== cribBedId) {
          movements.push({
            date,
            bedId: cribBedId,
            bedName: `Cuna (${getBedName(bedId)})`,
            bedType: 'CUNA',
            type: 'internal_move',
            details: `Desde cama ${lastMove.bedName}`,
          });
        }
      }
    }

    // 2. Check discharges/transfers (these end a session)
    for (const discharge of getActiveMovements(record.discharges)) {
      if (normalizeRut(discharge.rut) === normalizedRut) {
        lastSeenDate = date;
        movements.push({
          date,
          bedId: discharge.bedId,
          bedName: discharge.bedName,
          bedType: discharge.bedType,
          type: 'discharge',
          details: discharge.status === 'Fallecido' ? 'Fallecimiento' : discharge.dischargeType,
          time: discharge.time,
        });
        isEpisodeOpen = false;
        openEpisodeAdmissionDate = '';
      }
    }

    for (const transfer of getActiveMovements(record.transfers)) {
      if (normalizeRut(transfer.rut) === normalizedRut) {
        lastSeenDate = date;
        movements.push({
          date,
          bedId: transfer.bedId,
          bedName: transfer.bedName,
          bedType: transfer.bedType,
          type: 'transfer',
          details: `${transfer.evacuationMethod} → ${transfer.receivingCenter}`,
          time: transfer.time,
        });
        isEpisodeOpen = false;
        openEpisodeAdmissionDate = '';
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

  const firstSeenDate = movements[0].date;
  const totalDays = calculateDays(firstSeenDate, lastSeenDate);

  return {
    patientName: patientName || 'Paciente',
    rut,
    movements,
    totalDays,
    firstSeen: firstSeenDate,
    lastSeen: lastSeenDate,
  };
}
