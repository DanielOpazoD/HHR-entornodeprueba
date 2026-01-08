/**
 * BackupFilesView
 * 
 * View for browsing and downloading backup files (Handoffs, Census, CUDYR).
 * Now migrated to TanStack Query for robust data fetching and navigation.
 * Includes internal tabs for switching between backup types.
 */

import React, { useState, useEffect, useMemo } from 'react';
import {
    Folder,
    Search,
    LayoutGrid,
    List,
    RefreshCw,
    MessageSquare,
    LayoutList,
    BarChart3,
} from 'lucide-react';
import { useNotification, useConfirmDialog } from '@/context/UIContext';
import { useBackupFilesQuery } from '@/hooks/useBackupFilesQuery';
import { FolderCard, FileCard, Breadcrumbs } from './components/BackupDriveItems';
import { HandoffCalendarView } from './components/HandoffCalendarView';
import { ExcelViewerModal } from '@/components/shared/ExcelViewerModal';
import { PdfViewerModal } from '@/components/shared/PdfViewerModal';
import { deletePdf } from '@/services/backup/pdfStorageService';
import { deleteCensusFile } from '@/services/backup/censusStorageService';
import { deleteCudyrFile } from '@/services/backup/cudyrStorageService';
import { formatFileSize } from '@/services/backup/baseStorageService';
import { useAuth } from '@/context/AuthContext';
import clsx from 'clsx';

export type BackupType = 'handoff' | 'census' | 'cudyr';

// Tab configuration for backup types
const BACKUP_TABS: { type: BackupType; label: string; icon: React.ElementType }[] = [
    { type: 'handoff', label: 'Entregas', icon: MessageSquare },
    { type: 'census', label: 'Censo', icon: LayoutList },
    { type: 'cudyr', label: 'CUDYR', icon: BarChart3 },
];

interface BackupFilesViewProps {
    backupType?: BackupType; // Now optional, defaults to 'handoff'
}

export const BackupFilesView: React.FC<BackupFilesViewProps> = ({ backupType: initialBackupType = 'handoff' }) => {
    // Internal state for selected backup type (tabs)
    const [selectedBackupType, setSelectedBackupType] = useState<BackupType>(initialBackupType);
    const { success, error: notifyError } = useNotification();
    const { confirm } = useConfirmDialog();
    const { role } = useAuth();
    const canDelete = role === 'admin';

    // Navigation state
    const [path, setPath] = useState<string[]>([]);

    // View state
    const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
    const [searchQuery, setSearchQuery] = useState('');
    const [previewFile, setPreviewFile] = useState<any | null>(null);

    // 1. Data Query
    const {
        data: items = [],
        isLoading,
        isRefetching,
        refetch
    } = useBackupFilesQuery(selectedBackupType, path);

    // Auto-navigate to current year/month on mount or type change
    useEffect(() => {
        const now = new Date();
        const currentYear = now.getFullYear().toString();
        const monthNames = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
            'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
        const currentMonthName = monthNames[now.getMonth()];

        setPath([currentYear, currentMonthName]);
    }, [selectedBackupType]);

    // Derived states
    const filteredItems = useMemo(() => {
        if (!searchQuery) return items;
        const q = searchQuery.toLowerCase();
        return items.filter(item => {
            if (item.type === 'folder') return item.data.name.toLowerCase().includes(q);
            return item.data.name.toLowerCase().includes(q) || (item.data.date && item.data.date.includes(q));
        });
    }, [items, searchQuery]);

    // Navigation handlers
    const handleFolderClick = (folderData: any) => {
        if (folderData.type === 'year') {
            setPath([folderData.name]);
        } else if (folderData.type === 'month') {
            setPath([path[0], folderData.name]);
        }
    };

    const handleBreadcrumbNavigate = (index: number) => {
        if (index === -1) {
            setPath([]);
        } else {
            setPath(path.slice(0, index + 1));
        }
    };

    const handleDelete = async (file: any) => {
        const confirmed = await confirm({
            title: 'Eliminar Archivo',
            message: `¿Está seguro de eliminar "${file.name}"?\nEsta acción no se puede deshacer.`,
            confirmText: 'Eliminar',
            cancelText: 'Cancelar',
            variant: 'danger'
        });

        if (!confirmed) return;

        try {
            if (selectedBackupType === 'handoff') {
                await deletePdf(file.date, file.shiftType);
            } else if (selectedBackupType === 'census') {
                await deleteCensusFile(file.date);
            } else {
                await deleteCudyrFile(file.date);
            }
            success('Archivo eliminado');
            refetch();
        } catch (err) {
            console.error('Delete error:', err);
            notifyError('Error al eliminar archivo');
        }
    };

    const handleDownload = (file: any) => {
        if (file.downloadUrl) {
            window.open(file.downloadUrl, '_blank');
        }
    };

    const renderContent = () => {
        if (isLoading && !isRefetching) {
            return (
                <div className="flex flex-col items-center justify-center py-20 animate-pulse">
                    <RefreshCw className="w-12 h-12 text-slate-300 animate-spin mb-4" />
                    <p className="text-slate-400 font-medium">Buscando archivos...</p>
                </div>
            );
        }

        if (items.length === 0) {
            return (
                <div className="flex flex-col items-center justify-center py-20 bg-slate-50 rounded-3xl border border-dashed border-slate-200">
                    <Folder className="w-16 h-16 text-slate-200 mb-4" />
                    <p className="text-slate-400 font-medium">No se encontraron archivos en esta ubicación</p>
                </div>
            );
        }

        // Calendar View for Handoffs in month view
        if (selectedBackupType === 'handoff' && path.length === 2) {
            const files = items.filter(i => i.type === 'file').map(i => i.data);
            return (
                <HandoffCalendarView
                    files={files}
                    onView={(file) => setPreviewFile(file)}
                    onDownload={(file) => handleDownload(file)}
                    onDelete={handleDelete}
                    canDelete={canDelete}
                    formatSize={formatFileSize}
                />
            );
        }

        // Use compact grid for census/cudyr
        const isCompactView = selectedBackupType !== 'handoff';

        return (
            <div className={clsx(
                isCompactView ? "gap-2" : "gap-4",
                viewMode === 'grid'
                    ? isCompactView
                        ? "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5"
                        : "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
                    : "flex flex-col"
            )}>
                {filteredItems.map((item, idx) => (
                    item.type === 'folder' ? (
                        <FolderCard
                            key={item.data.name}
                            name={item.data.name}
                            onClick={() => handleFolderClick(item.data)}
                        />
                    ) : (
                        <FileCard
                            key={item.data.path || idx}
                            name={item.data.name}
                            date={item.data.date}
                            shift={item.data.shiftType || 'day'}
                            size={formatFileSize(item.data.size)}
                            onView={() => setPreviewFile(item.data)}
                            onDownload={() => handleDownload(item.data)}
                            onDelete={() => handleDelete(item.data)}
                            canDelete={canDelete}
                            hideShift={selectedBackupType !== 'handoff'}
                            compact={selectedBackupType !== 'handoff'}
                        />
                    )
                ))}
            </div>
        );
    };

    return (
        <div className="space-y-6">
            {/* Tabs for Backup Types */}
            <div className="flex gap-1 bg-white p-2 rounded-2xl shadow-sm border border-slate-100">
                {BACKUP_TABS.map(({ type, label, icon: Icon }) => (
                    <button
                        key={type}
                        onClick={() => {
                            setSelectedBackupType(type);
                            setPath([]); // Reset navigation when switching tabs
                        }}
                        className={clsx(
                            "flex items-center gap-2 px-4 py-2.5 rounded-xl font-medium text-sm transition-all duration-200",
                            selectedBackupType === type
                                ? "bg-medical-600 text-white shadow-md"
                                : "text-slate-600 hover:bg-slate-50"
                        )}
                    >
                        <Icon size={18} />
                        {label}
                    </button>
                ))}
            </div>

            {/* Header and Breadcrumbs */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white p-4 rounded-3xl shadow-sm border border-slate-100">
                <Breadcrumbs path={path} onNavigate={handleBreadcrumbNavigate} />

                <div className="flex items-center gap-2 shrink-0">
                    <div className="relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                        <input
                            type="text"
                            placeholder="Buscar..."
                            className="pl-9 pr-4 py-2 bg-slate-50 border-none rounded-xl text-sm focus:ring-2 focus:ring-medical-500 w-full md:w-48 lg:w-64"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                        />
                    </div>

                    <div className="flex bg-slate-50 p-1 rounded-xl">
                        <button
                            onClick={() => setViewMode('grid')}
                            className={clsx("p-1.5 rounded-lg transition-all", viewMode === 'grid' ? "bg-white shadow-sm text-medical-600" : "text-slate-400")}
                        >
                            <LayoutGrid size={18} />
                        </button>
                        <button
                            onClick={() => setViewMode('list')}
                            className={clsx("p-1.5 rounded-lg transition-all", viewMode === 'list' ? "bg-white shadow-sm text-medical-600" : "text-slate-400")}
                        >
                            <List size={18} />
                        </button>
                    </div>

                    <button
                        onClick={() => refetch()}
                        className={clsx(
                            "p-2 rounded-xl border border-slate-100 transition-all active:scale-95",
                            isRefetching ? "text-medical-600 bg-medical-50" : "text-slate-500 hover:bg-slate-50"
                        )}
                        title="Refrescar"
                        disabled={isLoading}
                    >
                        <RefreshCw size={18} className={isRefetching ? "animate-spin" : ""} />
                    </button>
                </div>
            </div>

            {/* List/Grid Content */}
            <div className="min-h-[400px]">
                {renderContent()}
            </div>

            {/* Previews */}
            {previewFile && (
                <>
                    {previewFile.name.endsWith('.xlsx') ? (
                        <ExcelViewerModal
                            fileName={previewFile.name}
                            downloadUrl={previewFile.downloadUrl}
                            onClose={() => setPreviewFile(null)}
                            onDownload={() => handleDownload(previewFile)}
                            canDownload={true}
                            subtitle={selectedBackupType === 'census' ? 'Censo Hospital Hanga Roa' : 'CUDYR Hospital Hanga Roa'}
                        />
                    ) : (
                        <PdfViewerModal
                            fileName={previewFile.name}
                            url={previewFile.downloadUrl}
                            onClose={() => setPreviewFile(null)}
                            onDownload={() => handleDownload(previewFile)}
                        />
                    )}
                </>
            )}
        </div>
    );
};

export default BackupFilesView;
