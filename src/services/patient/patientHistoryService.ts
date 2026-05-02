/**
 * Patient History Service
 *
 * Retrieves the movement history of a patient across all daily records.
 * Searches by RUT to find all beds, discharges, and transfers.
 */

import type {
  DailyRecord,
  DailyRecordPatientHistoryState,
} from '@/services/contracts/dailyRecordServiceContracts';
import { getAllRecords, saveRecords } from '@/services/storage/indexeddb/indexedDbRecordService';
import {
  getAllRecordsFromFirestore,
  getRecordsRangeFromFirestore,
} from '@/services/storage/firestore';
import { isFirestoreEnabled } from '@/services/repositories/repositoryConfig';
import type { HospitalizationEvent } from '@/types/domain/patientMaster';
import { BEDS } from '@/constants/beds';

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

export interface PatientHistoryLoadOptions {
  hospitalizationHints?: HospitalizationEvent[];
  lastAdmission?: string;
  lastDischarge?: string;
  forceFullRemoteHydration?: boolean;
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

const resolveLatestAdmissionDateHint = (options?: PatientHistoryLoadOptions): string | null => {
  const admissionHint = (options?.hospitalizationHints ?? [])
    .filter(event => event.type === 'Ingreso')
    .map(event => event.date)
    .sort()
    .at(-1);

  return admissionHint || options?.lastAdmission || null;
};

const resolveLatestCloseDateHint = (options?: PatientHistoryLoadOptions): string | null => {
  const closeHint = (options?.hospitalizationHints ?? [])
    .filter(
      event =>
        event.type === 'Egreso' || event.type === 'Traslado' || event.type === 'Fallecimiento'
    )
    .map(event => event.date)
    .sort()
    .at(-1);

  return closeHint || options?.lastDischarge || null;
};

const resolveRemoteHistoryRange = (
  options?: PatientHistoryLoadOptions
): { startDate: string; endDate: string } | null => {
  const startDate = resolveLatestAdmissionDateHint(options);
  if (!startDate) {
    return null;
  }

  const latestKnownCloseDate = [resolveLatestCloseDateHint(options)]
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(-1);
  const today = new Date().toISOString().slice(0, 10);
  const endDate = latestKnownCloseDate || today;

  return {
    startDate,
    endDate: endDate >= startDate ? endDate : startDate,
  };
};

const mergeRecords = (
  localRecords: Record<string, DailyRecordPatientHistoryState>,
  remoteRecords: DailyRecordPatientHistoryState[]
): Record<string, DailyRecordPatientHistoryState> => {
  const merged = { ...localRecords };

  remoteRecords.forEach(record => {
    merged[record.date] = record;
  });

  return merged;
};

const loadPatientHistoryRecords = async (
  options?: PatientHistoryLoadOptions
): Promise<Record<string, DailyRecordPatientHistoryState>> => {
  const localRecords = (await getAllRecords()) as Record<string, DailyRecordPatientHistoryState>;
  if (!isFirestoreEnabled()) {
    return localRecords;
  }

  const remoteRange = options?.forceFullRemoteHydration ? null : resolveRemoteHistoryRange(options);

  try {
    const remoteRecords = remoteRange
      ? ((await getRecordsRangeFromFirestore(
          remoteRange.startDate,
          remoteRange.endDate
        )) as DailyRecordPatientHistoryState[])
      : (Object.values(await getAllRecordsFromFirestore()) as DailyRecordPatientHistoryState[]);

    if (remoteRecords.length > 0) {
      await saveRecords(remoteRecords as unknown as DailyRecord[]);
    }

    return mergeRecords(localRecords, remoteRecords);
  } catch {
    return localRecords;
  }
};

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

  const normalizedRut = normalizeRut(rut);
  const allRecords = await loadPatientHistoryRecords(options);

  // Sort records by date (oldest first for timeline)
  const sortedDates = Object.keys(allRecords).sort();

  const movements: PatientMovement[] = [];
  let patientName = '';
  let lastSeenDate = '';
  let openEpisodeAdmissionDate = '';
  let isEpisodeOpen = false;

  // We process records to find movements and the latest admission date
  for (const date of sortedDates) {
    const record: DailyRecordPatientHistoryState = allRecords[date];

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
          time: discharge.time,
        });
        isEpisodeOpen = false;
        openEpisodeAdmissionDate = '';
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
