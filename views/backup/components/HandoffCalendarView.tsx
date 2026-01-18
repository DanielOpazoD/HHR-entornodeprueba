/**
 * Handoff Calendar View Component
 * Displays handoff files in a compact calendar-like table with day/night columns
 */

import React from 'react';
import { Download, Trash2, Sun, Moon, Calendar, Eye } from 'lucide-react';
import { StoredPdfFile } from '@/services/backup/pdfStorageService';
import { generateDateRange, formatDateDDMMYYYY } from '@/utils/dateUtils';
import { MONTH_NAMES } from '@/services/backup/baseStorageService';

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
    formatSize
}) => {
    // 1. Convert month name to number
    const monthNumber = MONTH_NAMES.indexOf(monthName) + 1;

    if (monthNumber < 1) {
        return null;
    }

    // 2. Determine if we should limit to today
    const now = new Date();
    const isCurrentMonth = now.getFullYear() === year && (now.getMonth() + 1) === monthNumber;

    // 3. Generate all days for this month (limited to today if current)
    const allDays = generateDateRange(year, monthNumber, isCurrentMonth);

    // 4. Group existing files by date
    const groupedByDate = files.reduce<Record<string, DayRow>>((acc, file) => {
        if (!acc[file.date]) {
            acc[file.date] = {
                date: file.date,
                displayDate: formatDateDDMMYYYY(file.date)
            };
        }
        if (file.shiftType === 'day') {
            acc[file.date].dayFile = file;
        } else {
            acc[file.date].nightFile = file;
        }
        return acc;
    }, {});

    // 4. Create rows for ALL days of the month
    const rows: DayRow[] = allDays.map(dateStr => {
        return groupedByDate[dateStr] || {
            date: dateStr,
            displayDate: formatDateDDMMYYYY(dateStr)
        };
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
                    {rows.map((row) => (
                        <tr key={row.date} className="hover:bg-slate-50/50 transition-colors">
                            <td className="px-2 py-1">
                                <span className="font-medium text-slate-700 text-xs">{row.displayDate}</span>
                            </td>
                            <td className="px-1 py-0.5 text-center">
                                <ShiftCell
                                    file={row.dayFile}
                                    shiftType="day"
                                    onDownload={onDownload}
                                    onView={onView}
                                    onDelete={onDelete}
                                    canDelete={canDelete}
                                    formatSize={formatSize}
                                />
                            </td>
                            <td className="px-1 py-0.5 text-center">
                                <ShiftCell
                                    file={row.nightFile}
                                    shiftType="night"
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

interface ShiftCellProps {
    file?: StoredPdfFile;
    shiftType: 'day' | 'night';
    onDownload: (file: StoredPdfFile) => void;
    onView: (file: StoredPdfFile) => void;
    onDelete: (file: StoredPdfFile) => void;
    canDelete: boolean;
    formatSize: (bytes: number) => string;
}

const ShiftCell: React.FC<ShiftCellProps> = ({
    file,
    shiftType,
    onDownload,
    onView,
    onDelete,
    canDelete,
    formatSize
}) => {
    if (!file) {
        return (
            <div className="flex items-center justify-center h-6">
                <span className="text-[10px] text-slate-300 italic">—</span>
            </div>
        );
    }

    const bgColor = shiftType === 'day'
        ? 'bg-amber-50 hover:bg-amber-100 border-amber-200'
        : 'bg-indigo-50 hover:bg-indigo-100 border-indigo-200';

    return (
        <div className={`inline-flex items-center justify-center gap-1 px-1.5 py-0.5 rounded border ${bgColor} transition-colors`}>
            <div className="flex items-center shrink-0">
                <button
                    onClick={() => onView(file)}
                    className="p-0.5 text-blue-600 hover:bg-blue-100 rounded transition-colors"
                    title="Ver"
                >
                    <Eye size={12} />
                </button>
                <button
                    onClick={() => onDownload(file)}
                    className="p-0.5 text-teal-600 hover:bg-teal-100 rounded transition-colors"
                    title="Descargar"
                >
                    <Download size={12} />
                </button>
                {canDelete && (
                    <button
                        onClick={() => onDelete(file)}
                        className="p-0.5 text-red-500 hover:bg-red-100 rounded transition-colors"
                        title="Eliminar"
                    >
                        <Trash2 size={12} />
                    </button>
                )}
            </div>
            {file.size && <span className="text-[9px] text-slate-500 font-medium tabular-nums border-l border-slate-200 pl-1 ml-0.5">{formatSize(file.size)}</span>}
        </div>
    );
};

export default HandoffCalendarView;

