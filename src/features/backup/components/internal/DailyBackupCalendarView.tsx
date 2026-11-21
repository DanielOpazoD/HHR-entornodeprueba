/**
 * Daily Backup Calendar View Component
 * Displays daily backup artifacts (Census, CUDYR) in a compact table showing all days of the month.
 */

import React from 'react';
import { getClinicalCalendarDateISO } from '@/utils/clinicalTimeZone';
import { Calendar, FileText } from 'lucide-react';
import type { BaseStoredFile } from '@/types/backupArtifacts';
import { generateDateRange } from '@/utils/dateRangeUtils';
import { findMonthIndexByName } from '@/constants/export';
import { formatBackupDisplayDate } from '@/shared/backup/backupPresentation';
import { BackupFileCell } from './BackupFileCell';

interface DailyBackupCalendarViewProps {
  files: BaseStoredFile[];
  year: number;
  monthName: string;
  onDownload: (file: BaseStoredFile) => void;
  onView: (file: BaseStoredFile) => void;
  onDelete: (file: BaseStoredFile) => void;
  canDelete: boolean;
  formatSize: (bytes: number) => string;
}

export const DailyBackupCalendarView: React.FC<DailyBackupCalendarViewProps> = ({
  files,
  year,
  monthName,
  onDownload,
  onView,
  onDelete,
  canDelete,
  formatSize,
}) => {
  // 1. Convert month name to number
  const monthNumber = findMonthIndexByName(monthName) + 1;

  // 2. Determine if we should limit to today
  const [currentYear, currentMonth] = getClinicalCalendarDateISO().split('-').map(Number);
  const isCurrentMonth = currentYear === year && currentMonth === monthNumber;

  // 3. Generate all days for this month (limited to today if current)
  const allDays = generateDateRange(year, monthNumber, isCurrentMonth);

  // 4. Map files to dates
  const fileMap = React.useMemo(() => {
    const map: Record<string, BaseStoredFile> = {};
    files.forEach(file => {
      map[file.date] = file;
    });
    return map;
  }, [files]);

  if (allDays.length === 0) {
    return null;
  }

  return (
    <div className="overflow-hidden rounded-lg border border-slate-200 max-w-sm">
      <table className="w-full text-xs">
        <thead>
          <tr className="bg-slate-50 border-b border-slate-200">
            <th className="px-2 py-1.5 text-left font-semibold text-slate-600 uppercase tracking-wider w-24">
              <div className="flex items-center gap-1">
                <Calendar size={11} />
                Fecha
              </div>
            </th>
            <th className="px-2 py-1.5 text-center font-semibold text-slate-600 uppercase tracking-wider">
              <div className="flex items-center justify-center gap-1">
                <FileText size={11} className="text-medical-500" />
                Respaldo del día
              </div>
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {allDays.map(dateStr => (
            <tr key={dateStr} className="hover:bg-slate-50/50 transition-colors">
              <td className="px-2 py-1">
                <span className="font-medium text-slate-700 text-xs">
                  {formatBackupDisplayDate(dateStr)}
                </span>
              </td>
              <td className="px-1 py-0.5 text-center">
                <BackupFileCell
                  file={fileMap[dateStr]}
                  toneClassName="bg-slate-50 hover:bg-slate-100 border-slate-200"
                  onDownload={onDownload}
                  onView={onView}
                  onDelete={onDelete}
                  canDelete={canDelete}
                  formatSize={formatSize}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

export default DailyBackupCalendarView;
