import { getPreviousDay } from '@/utils/clinicalDayUtils';
import type { DailyRecordDateRef } from '@/types/domain/dailyRecordSlices';

export interface CensusPromptState {
  previousRecordAvailable: boolean;
  previousRecordDate?: string;
}

export interface CensusPromptDataLoadDeps {
  currentDateString: string;
  getPreviousDay: (date: string) => Promise<DailyRecordDateRef | null>;
}

export const INITIAL_CENSUS_PROMPT_STATE: CensusPromptState = {
  previousRecordAvailable: false,
  previousRecordDate: undefined,
};

/** Only the calendar day right before the selected one can be copied. */
export const resolvePreviousDayState = (
  currentDateString: string,
  previousDay: DailyRecordDateRef | null
): CensusPromptState => {
  const yesterday = getPreviousDay(currentDateString);
  return previousDay?.date === yesterday
    ? { previousRecordAvailable: true, previousRecordDate: yesterday }
    : INITIAL_CENSUS_PROMPT_STATE;
};

export const executeLoadCensusPromptDataController = async ({
  currentDateString,
  getPreviousDay: readPreviousDay,
}: CensusPromptDataLoadDeps): Promise<CensusPromptState> =>
  resolvePreviousDayState(
    currentDateString,
    await readPreviousDay(currentDateString).catch(() => null)
  );
