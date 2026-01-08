/**
 * Handoff Calendar View Component
 * Displays handoff files in a compact calendar-like table with day/night columns
 */

import React from 'react';
import { Download, Trash2, Sun, Moon, Calendar, Eye } from 'lucide-react';
import { StoredPdfFile } from '@/services/backup/pdfStorageService';

interface HandoffCalendarViewProps {
    files: StoredPdfFile[];
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
    onDownload,
    onView,
    onDelete,
    canDelete,
    formatSize
}) => {
    // Group files by date
    const groupedByDate = files.reduce<Record<string, DayRow>>((acc, file) => {
        if (!acc[file.date]) {
            const [year, month, day] = file.date.split('-');
            acc[file.date] = {
                date: file.date,
                displayDate: `${day}-${month}-${year}`
            };
        }
        if (file.shiftType === 'day') {
            acc[file.date].dayFile = file;
        } else {
            acc[file.date].nightFile = file;
        }
        return acc;
    }, {});

    // Sort by date ascending (oldest first - chronological order)
    const rows = Object.values(groupedByDate).sort((a, b) => a.date.localeCompare(b.date));

    if (rows.length === 0) {
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
    const iconColor = shiftType === 'day' ? 'text-amber-500' : 'text-indigo-500';

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

