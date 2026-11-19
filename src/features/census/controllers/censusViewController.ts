import type { BedDefinition } from '@/types/domain/beds';
import type { Statistics } from '@/types/domain/statistics';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { CSSProperties } from 'react';
import type { CensusAccessProfile } from '@/shared/access/censusAccessProfile';
import type { CensusEmptyStateDiagnostic } from '@/features/census/controllers/censusEmptyStateDiagnostic';
import type { RenderCensusMedicalHandoffAction } from '@/features/census/contracts/censusMedicalHandoffAction';
import type { DailyRecordBootstrapPhase } from '@/hooks/controllers/dailyRecordBootstrapController';
import type { RemoteSyncRuntimeStatus } from '@/services/repositories/repositoryConfig';

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
  ) => Promise<boolean>;
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
  renderMedicalHandoffAction?: RenderCensusMedicalHandoffAction;
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
  renderMedicalHandoffAction,
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
  ...(renderMedicalHandoffAction ? { renderMedicalHandoffAction } : {}),
  ...(accessProfile ? { accessProfile } : {}),
});

/** What the census shows for the selected day: one closed state instead of loose flags. */
export type CensusDayView =
  | { kind: 'register'; registerContentProps: ReturnType<typeof buildRegisterContentProps> }
  | { kind: 'confirmedEmpty'; emptyDayPromptProps: ReturnType<typeof buildEmptyDayPromptProps> }
  | { kind: 'readFailed' }
  | { kind: 'loading' };

export interface ResolveCensusDayViewParams {
  registerContentProps: ReturnType<typeof buildRegisterContentProps> | null;
  emptyDayPromptProps: ReturnType<typeof buildEmptyDayPromptProps> | null;
  remoteSyncStatus: RemoteSyncRuntimeStatus;
  bootstrapPhase: DailyRecordBootstrapPhase;
}

/**
 * A record shows the register. Without one, only an absence the server confirmed, with the remote
 * runtime up, offers creating or copying the day; elapsed time and cached misses never do. A failed
 * read of this day is never «no data» (SAVE-01). A save error, of this day or another, is not an
 * input: it never opens the «could not check» box.
 */
export const resolveCensusDayView = ({
  registerContentProps,
  emptyDayPromptProps,
  remoteSyncStatus,
  bootstrapPhase,
}: ResolveCensusDayViewParams): CensusDayView => {
  if (registerContentProps) return { kind: 'register', registerContentProps };
  if (bootstrapPhase === 'remote_record_timeout') return { kind: 'readFailed' };
  if (
    emptyDayPromptProps &&
    bootstrapPhase === 'confirmed_empty' &&
    remoteSyncStatus !== 'bootstrapping'
  ) {
    return { kind: 'confirmedEmpty', emptyDayPromptProps };
  }
  return { kind: 'loading' };
};
