/**
 * Backup File Card Component (Google Drive style)
 * Displays a single backup file in a list format
 */

import React from 'react';
import { FileText, Eye, Trash2, Download, Clock, User, Sun, Moon } from 'lucide-react';
import { BackupFilePreview } from '@/types/backup';

interface BackupFileCardProps {
    file: BackupFilePreview;
    onView: (id: string) => void;
    onDownloadPdf: (id: string) => void;
    onDelete?: (id: string) => void;
    canDelete?: boolean;
}

export const BackupFileCard: React.FC<BackupFileCardProps> = ({
    file,
    onView,
    onDownloadPdf,
    onDelete,
    canDelete = false
}) => {
    const isDay = file.shiftType === 'day';

    const formatDate = (dateStr: string) => {
        const date = new Date(dateStr + 'T12:00:00');
        return date.toLocaleDateString('es-CL', {
            weekday: 'short',
            day: '2-digit',
            month: 'short',
            year: 'numeric'
        });
    };

    const formatTime = (isoStr: string) => {
        const date = new Date(isoStr);
        return date.toLocaleTimeString('es-CL', {
            hour: '2-digit',
            minute: '2-digit'
        });
    };

    return (
        <div className="flex items-center gap-4 p-3 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 hover:border-slate-300 transition-all group">
            {/* File Icon */}
            <div className={`
                flex-shrink-0 w-10 h-12 rounded flex items-center justify-center
                ${isDay ? 'bg-amber-100' : 'bg-indigo-100'}
            `}>
                <FileText size={20} className={isDay ? 'text-amber-600' : 'text-indigo-600'} />
            </div>

            {/* File Info */}
            <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                    <h3 className="font-medium text-slate-800 text-sm truncate">
                        {file.title}
                    </h3>
                    {isDay ? (
                        <Sun size={14} className="text-amber-500 flex-shrink-0" />
                    ) : (
                        <Moon size={14} className="text-indigo-500 flex-shrink-0" />
                    )}
                </div>
                <div className="flex items-center gap-3 text-xs text-slate-500 mt-0.5">
                    <span className="flex items-center gap-1">
                        <User size={12} />
                        {file.metadata.deliveryStaff} → {file.metadata.receivingStaff}
                    </span>
                    <span className="flex items-center gap-1">
                        <Clock size={12} />
                        {formatTime(file.createdAt)}
                    </span>
                </div>
            </div>

            {/* Date Badge */}
            <div className="hidden sm:flex flex-col items-end text-right">
                <span className="text-xs font-medium text-slate-600">
                    {formatDate(file.date)}
                </span>
                <span className="text-xs text-slate-400">
                    {file.metadata.patientCount} pacientes
                </span>
            </div>

            {/* Actions */}
            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <button
                    onClick={() => onDownloadPdf(file.id)}
                    className="p-2 rounded-lg hover:bg-teal-100 text-teal-600 transition-colors"
                    title="Descargar PDF"
                >
                    <Download size={18} />
                </button>
                <button
                    onClick={() => onView(file.id)}
                    className="p-2 rounded-lg hover:bg-blue-100 text-blue-600 transition-colors"
                    title="Ver detalle"
                >
                    <Eye size={18} />
                </button>
                {canDelete && onDelete && (
                    <button
                        onClick={() => onDelete(file.id)}
                        className="p-2 rounded-lg hover:bg-red-100 text-red-500 transition-colors"
                        title="Eliminar"
                    >
                        <Trash2 size={18} />
                    </button>
                )}
            </div>
        </div>
    );
};
