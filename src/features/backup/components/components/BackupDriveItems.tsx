/**
 * Backup UI Components
 * Google Drive style components for folders and files
 */

import React from 'react';
import { Folder, FileText, ChevronRight, Download, Eye, Trash2 } from 'lucide-react';

// ============= Folder Card =============

interface FolderCardProps {
    name: string;
    onClick: () => void;
    itemCount?: number;
}

export const FolderCard: React.FC<FolderCardProps> = ({ name, onClick, itemCount }) => (
    <button
        onClick={onClick}
        className="flex items-center gap-3 p-3 bg-white border border-slate-200 rounded-xl hover:bg-slate-50 hover:border-teal-300 hover:shadow-sm transition-all text-left group"
    >
        <div className="p-2 bg-teal-50 text-teal-600 rounded-lg group-hover:bg-teal-100 transition-colors">
            <Folder size={20} fill="currentColor" fillOpacity={0.2} />
        </div>
        <div className="flex-1 min-w-0">
            <p className="font-medium text-slate-700 truncate">{name}</p>
            {itemCount !== undefined && (
                <p className="text-xs text-slate-400">{itemCount} elementos</p>
            )}
        </div>
        <ChevronRight size={16} className="text-slate-300 group-hover:text-teal-400 transition-colors" />
    </button>
);

// ============= File Card =============

interface FileCardProps {
    name: string;
    date: string;
    shift?: 'day' | 'night';
    size: string;
    onDownload: () => void;
    onView?: () => void;
    onDelete?: () => void;
    canDelete?: boolean;
    /** Hide the shift badge (for census/cudyr files) */
    hideShift?: boolean;
    /** Use compact layout */
    compact?: boolean;
}

export const FileCard: React.FC<FileCardProps> = ({
    name,
    date: _date,
    shift,
    size,
    onDownload,
    onView,
    onDelete,
    canDelete,
    hideShift = false,
    compact = false
}) => (
    <div className={`flex items-center gap-3 ${compact ? 'p-2' : 'p-3'} bg-white border border-slate-200 rounded-xl hover:bg-slate-50 hover:border-teal-300 transition-all group`}>
        <div className={`${compact ? 'p-1.5' : 'p-2.5'} bg-red-50 text-red-600 rounded-lg`}>
            <FileText size={compact ? 16 : 20} />
        </div>

        <div className="flex-1 min-w-0">
            <h4 className={`font-medium text-slate-800 ${compact ? 'text-xs' : 'text-sm'} truncate`}>{name}</h4>
            <div className="flex items-center gap-3 mt-0.5">
                {!hideShift && shift && (
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold uppercase ${shift === 'day' ? 'bg-amber-100 text-amber-700' : 'bg-indigo-100 text-indigo-700'
                        }`}>
                        {shift === 'day' ? 'Turno Largo' : 'Turno Noche'}
                    </span>
                )}
                <span className="text-xs text-slate-400">{size}</span>
            </div>
        </div>

        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            {onView && (
                <button
                    onClick={onView}
                    className="p-1.5 hover:bg-slate-200 rounded-lg text-slate-600 transition-colors"
                    title="Previsualizar"
                >
                    <Eye size={18} />
                </button>
            )}
            <button
                onClick={onDownload}
                className="p-1.5 hover:bg-slate-200 rounded-lg text-slate-600 transition-colors"
                title="Descargar"
            >
                <Download size={18} />
            </button>
            {canDelete && onDelete && (
                <button
                    onClick={onDelete}
                    className="p-1.5 hover:bg-red-100 rounded-lg text-red-600 transition-colors"
                    title="Eliminar"
                >
                    <Trash2 size={18} />
                </button>
            )}
        </div>
    </div>
);

// ============= Breadcrumbs =============

interface BreadcrumbsProps {
    path: string[];
    onNavigate: (index: number) => void;
}

export const Breadcrumbs: React.FC<BreadcrumbsProps> = ({ path, onNavigate }) => (
    <nav className="flex items-center gap-1 text-sm text-slate-500 mb-4 overflow-x-auto whitespace-nowrap pb-2 scrollbar-none">
        <button
            onClick={() => onNavigate(-1)}
            className="hover:text-teal-600 font-medium transition-colors"
        >
            Inicio
        </button>
        {path.map((item, index) => (
            <React.Fragment key={index}>
                <ChevronRight size={14} className="text-slate-300 flex-shrink-0" />
                <button
                    onClick={() => onNavigate(index)}
                    className={`hover:text-teal-600 font-medium transition-colors ${index === path.length - 1 ? 'text-teal-600' : ''
                        }`}
                >
                    {item}
                </button>
            </React.Fragment>
        ))}
    </nav>
);
