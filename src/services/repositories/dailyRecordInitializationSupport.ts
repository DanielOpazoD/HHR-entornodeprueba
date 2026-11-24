import { BedType } from '@/types/domain/beds';
import { OCCUPANCY_ONLY_EXTRA_BED_IDS } from '@/constants/beds';
import { DailyRecord } from '@/types/domain/dailyRecord';
import type { DailyRecordStaffingState } from '@/types/domain/dailyRecordSlices';
import {
  buildClinicalBedsFromPreviousRecord,
  buildEmptyClinicalBeds,
  preparePatientForCarryover,
} from '@/services/repositories/dailyRecordClinicalDomainService';
import { resolveInitialDayHandoff } from '@/services/repositories/dailyRecordHandoffDomainService';
import { createRecordDateTimestamp } from '@/services/repositories/dailyRecordMetadataDomainService';
import { normalizeMovementBedConsistency } from '@/services/repositories/clinicalMovementBedConsistencyPolicy';

export { preparePatientForCarryover };

export interface InheritedDailyRecordStaffing {
  nursesDay: string[];
  nursesNight: string[];
  tensDay: string[];
  tensNight: string[];
}

export const resolveInheritedDailyRecordStaffing = (
  prevRecord: DailyRecordStaffingState | null
): InheritedDailyRecordStaffing => {
  if (!prevRecord) {
    return {
      nursesDay: ['', ''],
      nursesNight: ['', ''],
      tensDay: ['', '', ''],
      tensNight: ['', '', ''],
    };
  }

  return {
    nursesDay: ['', ''],
    nursesNight: ['', ''],
    // Staff rosters belong to a specific clinical shift. Copying last night's TENS into the new
    // long shift creates false assignments and prevents Eloísa evidence from filling vacancies.
    tensDay: ['', '', ''],
    tensNight: ['', '', ''],
  };
};

export const buildInitializedDayRecord = (
  date: string,
  sourceRecord: DailyRecord | null
): DailyRecord => {
  // The source is the server's day as read. A bed still holding a patient whose episode that day
  // discharged or transferred is emptied before copying, as every write of the day would do.
  const prevRecord = sourceRecord && normalizeMovementBedConsistency(sourceRecord).record;
  const initialBeds = buildEmptyClinicalBeds();
  const inheritedStaff = resolveInheritedDailyRecordStaffing(prevRecord);
  const beds = prevRecord
    ? buildClinicalBedsFromPreviousRecord(initialBeds, prevRecord)
    : initialBeds;
  const inheritedExtraBeds = prevRecord ? [...(prevRecord.activeExtraBeds || [])] : [];
  const activeExtraBeds = [
    ...inheritedExtraBeds.filter(bedId => !OCCUPANCY_ONLY_EXTRA_BED_IDS.has(bedId)),
    ...[...OCCUPANCY_ONLY_EXTRA_BED_IDS].filter(
      bedId => Boolean(beds[bedId]?.patientName?.trim()) && beds[bedId]?.isBlocked !== true
    ),
  ];

  return {
    date,
    beds,
    discharges: [],
    transfers: [],
    cma: [],
    bedTypeOverrides: prevRecord
      ? { ...(prevRecord.bedTypeOverrides || {}) }
      : ({} as Record<string, BedType>),
    lastUpdated: new Date().toISOString(),
    dateTimestamp: createRecordDateTimestamp(date),
    nursesDayShift: inheritedStaff.nursesDay,
    nursesNightShift: inheritedStaff.nursesNight,
    tensDayShift: inheritedStaff.tensDay,
    tensNightShift: inheritedStaff.tensNight,
    activeExtraBeds: [...new Set(activeExtraBeds)],
    handoffNovedadesDayShift: resolveInitialDayHandoff(prevRecord),
    ...(prevRecord?.handoffSharedChecklist
      ? { handoffSharedChecklist: { ...prevRecord.handoffSharedChecklist } }
      : {}),
  };
};
