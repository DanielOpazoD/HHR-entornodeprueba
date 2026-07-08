import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { PatientData } from '@/services/contracts/patientServiceContracts';
import { buildMedicalHandoffSummary } from '@/domain/handoff/specialty';
import { resolveNursingHandoffNovedadesText } from '@/shared/handoff/handoffNovedades';
import {
  resolveDayShiftNurses,
  resolveNightShiftNurses,
} from '@/services/staff/dailyRecordStaffing';
import {
  getActiveCma,
  getActiveDischarges,
  getActiveTransfers,
} from '@/application/census/movementTombstonePolicy';

export interface DailyRecordClinicalFacet {
  beds: DailyRecord['beds'];
  getPatient: (bedId: string) => PatientData | undefined;
  forEachPatient: (visitor: (patient: PatientData, bedId: string) => void) => void;
}

export interface DailyRecordStaffingFacet {
  nursesDay: string[];
  nursesNight: string[];
  tensDay: string[];
  tensNight: string[];
}

export interface DailyRecordMovementsFacet {
  discharges: DailyRecord['discharges'];
  transfers: DailyRecord['transfers'];
  cma: DailyRecord['cma'];
}

export interface DailyRecordHandoffFacet {
  dayNovedades: string;
  nightNovedades: string;
  medicalNovedades: string;
}

export interface DailyRecordMetadataFacet {
  date: string;
  lastUpdated: string;
  schemaVersion?: number;
  dateTimestamp?: number;
  activeExtraBeds: string[];
}

export interface DailyRecordAggregate {
  record: DailyRecord;
  clinical: DailyRecordClinicalFacet;
  staffing: DailyRecordStaffingFacet;
  movements: DailyRecordMovementsFacet;
  handoff: DailyRecordHandoffFacet;
  metadata: DailyRecordMetadataFacet;
}

export const createDailyRecordAggregate = (record: DailyRecord): DailyRecordAggregate => ({
  record,
  clinical: {
    beds: record.beds,
    getPatient: bedId => record.beds[bedId],
    forEachPatient: visitor => {
      Object.entries(record.beds).forEach(([bedId, patient]) => {
        visitor(patient, bedId);
      });
    },
  },
  staffing: {
    nursesDay: resolveDayShiftNurses(record),
    nursesNight: resolveNightShiftNurses(record),
    tensDay: record.tensDayShift || [],
    tensNight: record.tensNightShift || [],
  },
  movements: {
    discharges: getActiveDischarges(record.discharges),
    transfers: getActiveTransfers(record.transfers),
    cma: getActiveCma(record.cma),
  },
  handoff: {
    dayNovedades: resolveNursingHandoffNovedadesText({
      selectedShift: 'day',
      handoffNovedadesDayShift: record.handoffNovedadesDayShift,
      handoffNovedadesNightShift: record.handoffNovedadesNightShift,
    }),
    nightNovedades: resolveNursingHandoffNovedadesText({
      selectedShift: 'night',
      handoffNovedadesDayShift: record.handoffNovedadesDayShift,
      handoffNovedadesNightShift: record.handoffNovedadesNightShift,
    }),
    medicalNovedades: buildMedicalHandoffSummary(record),
  },
  metadata: {
    date: record.date,
    lastUpdated: record.lastUpdated,
    schemaVersion: record.schemaVersion,
    dateTimestamp: record.dateTimestamp,
    activeExtraBeds: record.activeExtraBeds || [],
  },
});
