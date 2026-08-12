import type { Statistics } from '@/types/domain/statistics';
import type { CensusHeaderPatientContract } from '@/application/census/censusStaffHeaderContracts';
import {
  type CensusAccessProfile,
  isSpecialistCensusAccessProfile,
  resolveAdmissionsCountForRecord,
  resolveStaffDetailsState,
  resolveStaffIndicatorsState,
  resolveMovementSummaryState,
  resolveStaffSelectorsClassName,
  resolveStaffSelectorsState,
} from '@/features/census';
import type { DischargeData, TransferData } from '@/types/domain/movements';
import type { DailyRecordStaffingDetailsV1 } from '@/application/shared/dailyRecordStaffContracts';

interface CensusStaffData {
  date?: string;
  nursesDayShift?: string[] | null;
  nursesNightShift?: string[] | null;
  tensDayShift?: string[] | null;
  tensNightShift?: string[] | null;
  staffingDetailsV1?: DailyRecordStaffingDetailsV1;
}

interface CensusMovementsData {
  discharges?: DischargeData[] | null;
  transfers?: TransferData[] | null;
  cma?: Array<{ id: string }> | null;
}

export const buildCensusStaffHeaderReadModel = ({
  readOnly,
  stats,
  accessProfile,
  beds,
  recordDate,
  staffData,
  movementsData,
}: {
  readOnly: boolean;
  stats: Statistics | null;
  accessProfile: CensusAccessProfile;
  beds?: Record<string, CensusHeaderPatientContract | undefined> | null;
  recordDate?: string;
  staffData?: CensusStaffData | null;
  movementsData?: CensusMovementsData | null;
}) => {
  const staffSelectorsState = resolveStaffSelectorsState(staffData);
  const staffIndicatorsState = resolveStaffIndicatorsState(staffData);
  const staffDetailsState = resolveStaffDetailsState(staffData);
  const admissionsCount = resolveAdmissionsCountForRecord({
    beds,
    recordDate,
  });
  const movementSummaryState = resolveMovementSummaryState({
    ...(movementsData || {}),
    admissionsCount,
  });
  const specialistAccess = isSpecialistCensusAccessProfile(accessProfile);

  return {
    specialistAccess,
    staffSelectorsState,
    staffIndicatorsState,
    staffDetailsState,
    movementSummaryState,
    selectorsClassName: resolveStaffSelectorsClassName(readOnly),
    showSummary: Boolean(stats) && !specialistAccess,
  };
};
