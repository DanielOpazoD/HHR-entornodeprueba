import type { DailyRecord } from '@/types';

export interface CensusPromptState {
    previousRecordAvailable: boolean;
    previousRecordDate?: string;
    availableDates: string[];
}

export interface CensusPromptDataLoadDeps {
    currentDateString: string;
    getPreviousDay: (date: string) => Promise<DailyRecord | null>;
    getAvailableDates: () => Promise<string[]>;
}

export const INITIAL_CENSUS_PROMPT_STATE: CensusPromptState = {
    previousRecordAvailable: false,
    previousRecordDate: undefined,
    availableDates: []
};

export const resolvePreviousDayState = (
    previousDay: DailyRecord | null
): Pick<CensusPromptState, 'previousRecordAvailable' | 'previousRecordDate'> => ({
    previousRecordAvailable: Boolean(previousDay),
    previousRecordDate: previousDay?.date
});

export const filterAvailableDates = (
    currentDateString: string,
    dates: string[]
): string[] => {
    const uniqueDates = Array.from(new Set(dates));
    return uniqueDates.filter((date) => date !== currentDateString);
};

export const executeLoadCensusPromptDataController = async ({
    currentDateString,
    getPreviousDay,
    getAvailableDates
}: CensusPromptDataLoadDeps): Promise<CensusPromptState> => {
    const [previousDayResult, availableDatesResult] = await Promise.allSettled([
        getPreviousDay(currentDateString),
        getAvailableDates()
    ]);

    const previousDayState = previousDayResult.status === 'fulfilled'
        ? resolvePreviousDayState(previousDayResult.value)
        : {
            previousRecordAvailable: false,
            previousRecordDate: undefined
        };

    const availableDates = availableDatesResult.status === 'fulfilled'
        ? filterAvailableDates(currentDateString, availableDatesResult.value)
        : [];

    return {
        previousRecordAvailable: previousDayState.previousRecordAvailable,
        previousRecordDate: previousDayState.previousRecordDate,
        availableDates
    };
};
