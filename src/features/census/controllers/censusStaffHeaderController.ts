import type {
  DischargeData,
  TransferData,
} from '@/features/census/contracts/censusMovementContracts';
import type { CensusHeaderPatientContract } from '@/application/census/censusStaffHeaderContracts';
import { classifyPatientMovementForRecord } from '@/application/patient-flow/clinicalEpisode';
import {
  resolveDetailedStaffingState,
  resolveShiftRoleStaffingMeta,
} from '@/services/staff/dailyRecordDetailedStaffing';
import { resolveDetailedStaffingStandardNames } from '@/services/staff/dailyRecordStaffingStandardNames';
import type { DailyRecordStaffingDetailsV1 } from '@/types/domain/dailyRecordStaffingDetails';
import {
  getActiveDischarges,
  getActiveTransfers,
  getActiveMovements,
} from '@/application/census/movementTombstonePolicy';

export interface StaffSelectorsState {
  nursesDayShift: string[];
  nursesNightShift: string[];
  tensDayShift: string[];
  tensNightShift: string[];
}

export interface ShiftIndicatorState {
  extraCount: number;
  hasSpecialSchedule: boolean;
}

export interface StaffIndicatorsState {
  nurseIndicators: Record<'day' | 'night', ShiftIndicatorState>;
  tensIndicators: Record<'day' | 'night', ShiftIndicatorState>;
}

export interface MovementSummaryState {
  discharges: DischargeData[];
  transfers: TransferData[];
  cmaCount: number;
  admissionsCount: number;
}

interface StaffInput {
  date?: string;
  nursesDayShift?: string[] | null;
  nursesNightShift?: string[] | null;
  tensDayShift?: string[] | null;
  tensNightShift?: string[] | null;
  staffingDetailsV1?: DailyRecordStaffingDetailsV1;
}

interface MovementsInput {
  discharges?: DischargeData[] | null;
  transfers?: TransferData[] | null;
  cma?: Array<{ id: string }> | null;
  admissionsCount?: number | null;
}

interface AdmissionsInput {
  beds?: Record<string, CensusHeaderPatientContract | undefined> | null;
  recordDate?: string;
}

const ensureStringArray = (value?: string[] | null): string[] =>
  Array.isArray(value) ? value : [];

export const resolveStaffSelectorsState = (input?: StaffInput | null): StaffSelectorsState => {
  if (input?.date) {
    return resolveDetailedStaffingStandardNames(resolveDetailedStaffingState(input, input.date));
  }

  return {
    nursesDayShift: ensureStringArray(input?.nursesDayShift),
    nursesNightShift: ensureStringArray(input?.nursesNightShift),
    tensDayShift: ensureStringArray(input?.tensDayShift),
    tensNightShift: ensureStringArray(input?.tensNightShift),
  };
};

const EMPTY_SHIFT_INDICATOR: ShiftIndicatorState = {
  extraCount: 0,
  hasSpecialSchedule: false,
};

export const resolveStaffIndicatorsState = (input?: StaffInput | null): StaffIndicatorsState => {
  if (!input?.date) {
    return {
      nurseIndicators: {
        day: EMPTY_SHIFT_INDICATOR,
        night: EMPTY_SHIFT_INDICATOR,
      },
      tensIndicators: {
        day: EMPTY_SHIFT_INDICATOR,
        night: EMPTY_SHIFT_INDICATOR,
      },
    };
  }

  const detail = resolveDetailedStaffingState(input, input.date);

  return {
    nurseIndicators: {
      day: resolveShiftRoleStaffingMeta(detail, 'day', 'nurse'),
      night: resolveShiftRoleStaffingMeta(detail, 'night', 'nurse'),
    },
    tensIndicators: {
      day: resolveShiftRoleStaffingMeta(detail, 'day', 'tens'),
      night: resolveShiftRoleStaffingMeta(detail, 'night', 'tens'),
    },
  };
};

export const resolveStaffDetailsState = (
  input?: StaffInput | null
): DailyRecordStaffingDetailsV1 | null => {
  if (!input?.date) {
    return null;
  }

  return resolveDetailedStaffingState(input, input.date);
};

export const resolveMovementSummaryState = (
  input?: MovementsInput | null
): MovementSummaryState => ({
  discharges: getActiveDischarges(input?.discharges),
  transfers: getActiveTransfers(input?.transfers),
  cmaCount: getActiveMovements(input?.cma).length,
  admissionsCount: Math.max(0, input?.admissionsCount || 0),
});

const collectHospitalizedPatients = (
  beds?: Record<string, CensusHeaderPatientContract | undefined> | null
): CensusHeaderPatientContract[] => {
  if (!beds) return [];

  const patients: CensusHeaderPatientContract[] = [];
  Object.values(beds).forEach(patient => {
    if (patient?.patientName?.trim() && !patient?.isBlocked) {
      patients.push(patient);
    }

    if (patient?.clinicalCrib?.patientName?.trim() && !patient.clinicalCrib?.isBlocked) {
      patients.push(patient.clinicalCrib);
    }
  });

  return patients;
};

export const collectHospitalizedPatientsForRecord = collectHospitalizedPatients;

export const resolveAdmissionsCountForRecord = ({ beds, recordDate }: AdmissionsInput): number => {
  if (!recordDate) return 0;

  const patients = collectHospitalizedPatients(beds);
  return patients.filter(
    patient => classifyPatientMovementForRecord(recordDate, patient).isNewAdmission
  ).length;
};

export const resolveStaffSelectorsClassName = (readOnly: boolean): string =>
  readOnly ? 'pointer-events-none opacity-80' : '';
