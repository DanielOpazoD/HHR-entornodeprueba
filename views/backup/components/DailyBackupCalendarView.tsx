/**
 * Daily Backup Calendar View Component
 * Displays daily files (Census, CUDYR) in a compact table showing all days of the month.
 */

import React from 'react';
import { Download, Trash2, Calendar, Eye, FileText } from 'lucide-react';
import { BaseStoredFile } from '@/services/backup/baseStorageService';
import { generateDateRange, formatDateDDMMYYYY } from '@/utils/dateUtils';
import { MONTH_NAMES } from '@/services/backup/baseStorageService';

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
    formatSize
}) => {
    // 1. Convert month name to number
    const monthNumber = MONTH_NAMES.indexOf(monthName) + 1;

    // 2. Determine if we should limit to today
    const now = new Date();
    const isCurrentMonth = now.getFullYear() === year && (now.getMonth() + 1) === monthNumber;

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
                                Archivo
                            </div>
                        </th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                    {allDays.map((dateStr) => (
                        <tr key={dateStr} className="hover:bg-slate-50/50 transition-colors">
                            <td className="px-2 py-1">
                                <span className="font-medium text-slate-700 text-xs">{formatDateDDMMYYYY(dateStr)}</span>
                            </td>
                            <td className="px-1 py-0.5 text-center">
                                <FileCell
                                    file={fileMap[dateStr]}
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

interface FileCellProps {
    file?: BaseStoredFile;
    onDownload: (file: BaseStoredFile) => void;
    onView: (file: BaseStoredFile) => void;
    onDelete: (file: BaseStoredFile) => void;
    canDelete: boolean;
    formatSize: (bytes: number) => string;
}

const FileCell: React.FC<FileCellProps> = ({
    file,
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

    return (
        <div className="inline-flex items-center justify-center gap-1 px-1.5 py-0.5 rounded border bg-slate-50 hover:bg-slate-100 border-slate-200 transition-colors">
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

export default DailyBackupCalendarView;
