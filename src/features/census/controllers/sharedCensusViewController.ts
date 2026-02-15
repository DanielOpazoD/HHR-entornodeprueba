import type { StoredCensusFile } from '@/services/backup/censusStorageService';
import { MONTH_NAMES } from '@/services/backup/baseStorageService';
import type { CensusAccessUser } from '@/types/censusAccess';

interface ResolveSharedCensusViewStateParams {
    error: string | null;
    accessUser: CensusAccessUser | null;
    isLoading: boolean;
}

export type SharedCensusViewState = 'denied' | 'loading' | 'ready';

export interface SharedCensusFileCardModel {
    year: string;
    day: string;
    monthName: string;
    isCurrentMonth: boolean;
}

export const resolveSharedCensusViewState = ({
    error,
    accessUser,
    isLoading
}: ResolveSharedCensusViewStateParams): SharedCensusViewState => {
    if (error || (!accessUser && !isLoading)) {
        return 'denied';
    }

    if (isLoading) {
        return 'loading';
    }

    return 'ready';
};

export const resolveSharedCensusAccessDisplayName = (
    accessUser: CensusAccessUser
): string =>
    accessUser.displayName || accessUser.email;

export const buildSharedCensusFileCardModel = (
    file: Pick<StoredCensusFile, 'date'>,
    now: Date = new Date()
): SharedCensusFileCardModel => {
    const [year = '', month = '', day = ''] = file.date.split('-');
    const monthIndex = Number.parseInt(month, 10) - 1;
    const parsedYear = Number.parseInt(year, 10);
    const isCurrentMonth =
        Number.isFinite(parsedYear) &&
        monthIndex >= 0 &&
        monthIndex <= 11 &&
        now.getFullYear() === parsedYear &&
        now.getMonth() === monthIndex;

    return {
        year,
        day,
        monthName: MONTH_NAMES[monthIndex] || month || 'Mes',
        isCurrentMonth
    };
};
