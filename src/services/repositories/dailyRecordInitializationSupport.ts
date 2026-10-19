import { BedType } from '@/types/domain/beds';
import { OCCUPANCY_ONLY_EXTRA_BED_IDS } from '@/constants/beds';
import { DailyRecord } from '@/types/domain/dailyRecord';
import {
  assignCarriedPatientToRecord,
  buildClinicalBedsFromPreviousRecord,
  buildEmptyClinicalBeds,
  enrichInitializationRecordFromCopySource,
  preserveCIE10FromPreviousDay,
  preparePatientForCarryover,
} from '@/services/repositories/dailyRecordClinicalDomainService';
import { resolveInitialDayHandoff } from '@/services/repositories/dailyRecordHandoffDomainService';
import { createRecordDateTimestamp } from '@/services/repositories/dailyRecordMetadataDomainService';
import { createEmptyDailyRecordMovements } from '@/services/repositories/dailyRecordMovementsDomainService';
import { resolveInheritedDailyRecordStaffing } from '@/services/repositories/dailyRecordStaffingDomainService';

export {
  assignCarriedPatientToRecord,
  enrichInitializationRecordFromCopySource,
  preserveCIE10FromPreviousDay,
  preparePatientForCarryover,
};

export const buildInitializedDayRecord = (
  date: string,
  prevRecord: DailyRecord | null
): DailyRecord => {
  const initialBeds = buildEmptyClinicalBeds();
  const inheritedStaff = resolveInheritedDailyRecordStaffing(prevRecord);
  const beds = prevRecord
    ? buildClinicalBedsFromPreviousRecord(initialBeds, prevRecord)
    : initialBeds;
  const movements = createEmptyDailyRecordMovements();
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
    discharges: movements.discharges,
    transfers: movements.transfers,
    cma: movements.cma,
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
  };
};
