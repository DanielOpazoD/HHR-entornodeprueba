import type { PatientData } from '@/types/domain/patient';

import { BEDS, HOSPITAL_CAPACITY } from '@/constants/beds';
import { DailyStatsSnapshot } from '@/types/minsalTypes';
import type { DailyRecordMovementState as MinsalDailyRecord } from '@/types/domain/dailyRecordSlices';
import {
  getStatisticalDischarges,
  getActiveTransfers,
} from '@/application/census/movementTombstonePolicy';

export function countOccupiedBeds(beds: Record<string, PatientData>): number {
  let count = 0;
  BEDS.forEach(bed => {
    const data = beds[bed.id];
    if (data && !data.isBlocked && data.patientName?.trim()) {
      count++;
    }
  });
  return count;
}

export function countBlockedBeds(beds: Record<string, PatientData>): number {
  let count = 0;
  BEDS.forEach(bed => {
    const data = beds[bed.id];
    if (data?.isBlocked) {
      count++;
    }
  });
  return count;
}

export function calculateDailySnapshot(record: MinsalDailyRecord): DailyStatsSnapshot {
  const ocupadas = countOccupiedBeds(record.beds);
  const bloqueadas = countBlockedBeds(record.beds);
  const disponibles = HOSPITAL_CAPACITY - bloqueadas;

  const discharges = getStatisticalDischarges(record.discharges);
  const transfers = getActiveTransfers(record.transfers);
  const fallecidos = discharges.filter(d => d.status === 'Fallecido').length;
  const egresos = discharges.length + transfers.length;

  const tasaOcupacion = disponibles > 0 ? (ocupadas / disponibles) * 100 : 0;

  return {
    date: record.date,
    ocupadas,
    disponibles,
    bloqueadas,
    egresos,
    fallecidos,
    tasaOcupacion: Math.round(tasaOcupacion * 10) / 10,
  };
}
