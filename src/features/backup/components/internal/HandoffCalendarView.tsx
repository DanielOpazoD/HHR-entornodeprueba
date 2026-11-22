/**
 * Handoff Calendar View Component
 * Displays handoff files in a compact calendar-like table with day/night columns
 */

import React from 'react';
import { getClinicalCalendarDateISO } from '@/utils/clinicalTimeZone';
import { Sun, Moon, Calendar } from 'lucide-react';
import type { StoredPdfFile } from '@/types/backupArtifacts';
import { generateDateRange } from '@/utils/dateRangeUtils';
import { findMonthIndexByName } from '@/constants/export';
import { formatDateDDMMYYYY } from '@/utils/dateDisplayUtils';
import { BackupFileCell } from './BackupFileCell';

interface HandoffCalendarViewProps {
  files: StoredPdfFile[];
  year: number;
  monthName: string;
  onDownload: (file: StoredPdfFile) => void;
  onView: (file: StoredPdfFile) => void;
  onDelete: (file: StoredPdfFile) => void;
  canDelete: boolean;
  formatSize: (bytes: number) => string;
}

interface DayRow {
  date: string;
  displayDate: string;
  dayFile?: StoredPdfFile;
  nightFile?: StoredPdfFile;
}

export const HandoffCalendarView: React.FC<HandoffCalendarViewProps> = ({
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

  if (monthNumber < 1) {
    return null;
  }

  // 2. Determine if we should limit to today
  const [currentYear, currentMonth] = getClinicalCalendarDateISO().split('-').map(Number);
  const isCurrentMonth = currentYear === year && currentMonth === monthNumber;

  // 3. Generate all days for this month (limited to today if current)
  const allDays = generateDateRange(year, monthNumber, isCurrentMonth);

  // 4. Group existing files by date
  const groupedByDate = files.reduce<Record<string, DayRow>>((acc, file) => {
    let row = acc[file.date];
    if (!row) {
      row = {
        date: file.date,
        displayDate: formatDateDDMMYYYY(file.date),
      };
      acc[file.date] = row;
    }
    if (file.shiftType === 'day') {
      row.dayFile = file;
    } else {
      row.nightFile = file;
    }
    return acc;
  }, {});

  // 4. Create rows for ALL days of the month
  const rows: DayRow[] = allDays.map(dateStr => {
    return (
      groupedByDate[dateStr] || {
        date: dateStr,
        displayDate: formatDateDDMMYYYY(dateStr),
      }
    );
  });

  if (allDays.length === 0) {
    return null;
  }

  return (
    <div className="overflow-hidden rounded-lg border border-slate-200 max-w-md">
      <table className="w-full text-xs">
        <thead>
          <tr className="bg-slate-50 border-b border-slate-200">
            <th className="px-2 py-1.5 text-left font-semibold text-slate-600 uppercase tracking-wider w-24">
              <div className="flex items-center gap-1">
                <Calendar size={11} />
                Fecha
              </div>
            </th>
            <th className="px-2 py-1.5 text-center font-semibold text-slate-600 uppercase tracking-wider w-28">
              <div className="flex items-center justify-center gap-1">
                <Sun size={11} className="text-amber-500" />
                T. Largo
              </div>
            </th>
            <th className="px-2 py-1.5 text-center font-semibold text-slate-600 uppercase tracking-wider w-28">
              <div className="flex items-center justify-center gap-1">
                <Moon size={11} className="text-indigo-500" />
                T. Noche
              </div>
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map(row => (
            <tr key={row.date} className="hover:bg-slate-50/50 transition-colors">
              <td className="px-2 py-1">
                <span className="font-medium text-slate-700 text-xs">{row.displayDate}</span>
              </td>
              <td className="px-1 py-0.5 text-center">
                <BackupFileCell
                  file={row.dayFile}
                  toneClassName="bg-amber-50 hover:bg-amber-100 border-amber-200"
                  onDownload={onDownload}
                  onView={onView}
                  onDelete={onDelete}
                  canDelete={canDelete}
                  formatSize={formatSize}
                />
              </td>
              <td className="px-1 py-0.5 text-center">
                <BackupFileCell
                  file={row.nightFile}
                  toneClassName="bg-indigo-50 hover:bg-indigo-100 border-indigo-200"
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

export default HandoffCalendarView;
