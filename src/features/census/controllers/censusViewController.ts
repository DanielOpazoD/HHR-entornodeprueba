import type { BedDefinition } from '@/features/census/contracts/censusBedContracts';
import type { Statistics } from '@/types/domain/statistics';
import type { DailyRecord } from '@/features/census/contracts/censusRecordContracts';
import type { CSSProperties } from 'react';
import type { CensusAccessProfile } from '@/features/census/types/censusAccessProfile';
import type { CensusEmptyStateDiagnostic } from '@/hooks/controllers/dailyRecordBootstrapController';

export type CensusViewBranch = 'empty' | 'register';

export interface ResolveCensusViewBranchParams {
  beds: DailyRecord['beds'] | null;
}

export interface BuildEmptyDayPromptPropsParams {
  selectedDay: number;
  selectedMonth: number;
  currentDateString: string;
  previousRecordAvailable: boolean;
  previousRecordDate: string | undefined;
  availableDates: string[];
  onCreateDay: (
    copyFromPrevious: boolean,
    specificDate?: string,
    options?: { forceCopyScheduleOverride?: boolean }
  ) => void | Promise<void>;
  readOnly: boolean;
  allowAdminCopyOverride: boolean;
  emptyStateDiagnostic?: CensusEmptyStateDiagnostic;
}

export interface BuildRegisterContentPropsParams {
  currentDateString: string;
  readOnly: boolean;
  beds: DailyRecord['beds'];
  visibleBeds: BedDefinition[];
  marginStyle: CSSProperties;
  stats: Statistics | null;
  showBedManagerModal: boolean;
  onCloseBedManagerModal: () => void;
  onOpenMedicalHandoff?: () => void;
  accessProfile?: CensusAccessProfile;
}

export const resolveCensusViewBranch = ({
  beds,
}: ResolveCensusViewBranchParams): CensusViewBranch => (beds ? 'register' : 'empty');

export const buildEmptyDayPromptProps = ({
  selectedDay,
  selectedMonth,
  currentDateString,
  previousRecordAvailable,
  previousRecordDate,
  availableDates,
  onCreateDay,
  readOnly,
  allowAdminCopyOverride,
  emptyStateDiagnostic,
}: BuildEmptyDayPromptPropsParams) => ({
  selectedDay,
  selectedMonth,
  currentDateString,
  previousRecordAvailable,
  previousRecordDate,
  availableDates,
  onCreateDay,
  readOnly,
  allowAdminCopyOverride,
  ...(emptyStateDiagnostic ? { emptyStateDiagnostic } : {}),
});

export const buildRegisterContentProps = ({
  currentDateString,
  readOnly,
  beds,
  visibleBeds,
  marginStyle,
  stats,
  showBedManagerModal,
  onCloseBedManagerModal,
  onOpenMedicalHandoff,
  accessProfile,
}: BuildRegisterContentPropsParams) => ({
  currentDateString,
  readOnly,
  beds,
  visibleBeds,
  marginStyle,
  stats,
  showBedManagerModal,
  onCloseBedManagerModal,
  ...(onOpenMedicalHandoff ? { onOpenMedicalHandoff } : {}),
  ...(accessProfile ? { accessProfile } : {}),
});
