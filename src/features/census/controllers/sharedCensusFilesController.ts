import type { StoredCensusFile } from '@/services/backup/censusStorageService';

export interface SharedCensusMonthWindow {
    currentYear: string;
    currentMonth: string;
    previousYear: string;
    previousMonth: string;
}

interface SelectLatestSharedCensusFilesParams {
    currentFiles: StoredCensusFile[];
    previousFiles: StoredCensusFile[];
}

export const resolveSharedCensusMonthWindow = (now: Date): SharedCensusMonthWindow => {
    const currentMonthIndex = now.getMonth();
    const currentYear = now.getFullYear();
    const previousMonthIndex = currentMonthIndex === 0 ? 11 : currentMonthIndex - 1;
    const previousYear = currentMonthIndex === 0 ? currentYear - 1 : currentYear;

    return {
        currentYear: currentYear.toString(),
        currentMonth: String(currentMonthIndex + 1).padStart(2, '0'),
        previousYear: previousYear.toString(),
        previousMonth: String(previousMonthIndex + 1).padStart(2, '0')
    };
};

export const selectLatestSharedCensusFiles = ({
    currentFiles,
    previousFiles
}: SelectLatestSharedCensusFilesParams): StoredCensusFile[] => {
    const sortedCurrent = [...currentFiles].sort((a, b) => b.date.localeCompare(a.date));
    const sortedPrevious = [...previousFiles].sort((a, b) => b.date.localeCompare(a.date));

    return [sortedCurrent[0], sortedPrevious[0]].filter(
        (file): file is StoredCensusFile => !!file
    );
};

export const filterSharedCensusFilesByTerm = (
    files: StoredCensusFile[],
    searchTerm: string
): StoredCensusFile[] => {
    const normalizedTerm = searchTerm.trim().toLowerCase();
    if (!normalizedTerm) {
        return files;
    }

    return files.filter(file =>
        file.name.toLowerCase().includes(normalizedTerm) ||
        file.date.includes(normalizedTerm)
    );
};
