/**
 * useBackupFilesQuery Hook
 * TanStack Query wrapper for backup file listing.
 * Natively resolves race conditions when navigating between folders.
 */

import { useQuery } from '@tanstack/react-query';
import {
    listYears as listHandoffYears,
    listMonths as listHandoffMonths,
    listFilesInMonth as listHandoffFiles
} from '../services/backup/pdfStorageService';
import {
    listCensusYears,
    listCensusMonths,
    listCensusFilesInMonth
} from '../services/backup/censusStorageService';
import {
    listCudyrYears,
    listCudyrMonths,
    listCudyrFilesInMonth
} from '../services/backup/cudyrStorageService';
import { MONTH_NAMES } from '../services/backup/baseStorageService';

export type BackupItemType = 'folder' | 'file';

export interface BackupItem {
    type: BackupItemType;
    data: any;
}

const monthNameToNumber = (name: string): string => {
    const index = MONTH_NAMES.indexOf(name);
    return String(index + 1).padStart(2, '0');
};

export const useBackupFilesQuery = (backupType: string, path: string[]) => {
    return useQuery({
        queryKey: ['backups', backupType, ...path],
        queryFn: async (): Promise<BackupItem[]> => {
            console.log(`[useBackupFilesQuery] 📂 Fetching ${backupType} backups for path: /${path.join('/')}`);

            // 1. Determine service based on type
            const service = {
                listYears: backupType === 'handoff' ? listHandoffYears : (backupType === 'census' ? listCensusYears : listCudyrYears),
                listMonths: backupType === 'handoff' ? listHandoffMonths : (backupType === 'census' ? listCensusMonths : listCudyrMonths),
                listFilesInMonth: backupType === 'handoff' ? listHandoffFiles : (backupType === 'census' ? listCensusFilesInMonth : listCudyrFilesInMonth),
            };

            if (path.length === 0) {
                // Root: List years
                const years = await service.listYears();
                return years.map(year => ({
                    type: 'folder',
                    data: { name: year, type: 'year' }
                }));
            } else if (path.length === 1) {
                // Year: List months
                const year = path[0];
                const months = await service.listMonths(year);
                return months.map(month => ({
                    type: 'folder',
                    data: { name: month.name, number: month.number, type: 'month' }
                }));
            } else if (path.length === 2) {
                // Month: List files
                const year = path[0];
                const monthName = path[1];
                const monthNumber = monthNameToNumber(monthName);

                const files = await service.listFilesInMonth(year, monthNumber);

                return files.map(file => ({
                    type: 'file',
                    data: file
                }));
            }

            return [];
        },
        staleTime: 1000 * 60 * 5, // 5 minutes
    });
};
