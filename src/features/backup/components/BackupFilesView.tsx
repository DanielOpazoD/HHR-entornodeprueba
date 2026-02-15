/**
 * BackupFilesView
 * 
 * View for browsing and downloading backup files (Handoffs, Census, CUDYR).
 * Includes internal tabs for switching between backup types.
 */

import React from 'react';
import {
    Folder,
    Search,
    LayoutGrid,
    List,
    RefreshCw,
    MessageSquare,
    LayoutList,
    BarChart3,
    type LucideIcon,
} from 'lucide-react';
import { useBackupFileBrowser, BackupType } from '@/hooks/useBackupFileBrowser';
import { FolderCard, FileCard, Breadcrumbs } from './components/BackupDriveItems';
import { HandoffCalendarView } from './components/HandoffCalendarView';
import { DailyBackupCalendarView } from './components/DailyBackupCalendarView';
import { ExcelViewerModal } from '@/components/shared/ExcelViewerModal';
import { PdfViewerModal } from '@/components/shared/PdfViewerModal';
import { formatFileSize, BaseStoredFile } from '@/services/backup/baseStorageService';
import { StoredPdfFile } from '@/services/backup/pdfStorageService';
import { BackupFolder } from '@/hooks/useBackupFilesQuery';
import clsx from 'clsx';

// Tab configuration for backup types
const BACKUP_TABS: ReadonlyArray<{ type: BackupType; label: string; icon: LucideIcon }> = [
    { type: 'handoff', label: 'Entregas', icon: MessageSquare },
    { type: 'census', label: 'Censo', icon: LayoutList },
    { type: 'cudyr', label: 'CUDYR', icon: BarChart3 },
];

interface BackupFilesViewProps {
    backupType?: BackupType;
}

export const BackupFilesView: React.FC<BackupFilesViewProps> = ({ backupType: initialBackupType = 'handoff' }) => {
    const {
        selectedBackupType,
        path,
        viewMode,
        setViewMode,
        searchQuery,
        setSearchQuery,
        previewFile,
        setPreviewFile,
        items,
        filteredItems,
        isLoading,
        isRefetching,
        canDelete,
        refetch,
        handlers
    } = useBackupFileBrowser(initialBackupType);

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
                    <p className="text-slate-400 font-medium tracking-tight">No se encontraron archivos en esta ubicación</p>
                </div>
            );
        }

        // Calendar-like views for month view (path.length === 2)
        if (path.length === 2) {
            const currentYear = parseInt(path[0]);
            const currentMonthName = path[1];
            const files = items
                .filter(i => i.type === 'file')
                .map(i => i.data as BaseStoredFile | StoredPdfFile);

            if (selectedBackupType === 'handoff') {
                return (
                    <HandoffCalendarView
                        files={files as StoredPdfFile[]}
                        year={currentYear}
                        monthName={currentMonthName}
                        onView={(file) => setPreviewFile(file)}
                        onDownload={(file) => handlers.handleDownload(file)}
                        onDelete={handlers.handleDelete}
                        canDelete={canDelete}
                        formatSize={formatFileSize}
                    />
                );
            }

            return (
                <DailyBackupCalendarView
                    files={files}
                    year={currentYear}
                    monthName={currentMonthName}
                    onView={(file) => setPreviewFile(file)}
                    onDownload={(file) => handlers.handleDownload(file)}
                    onDelete={handlers.handleDelete}
                    canDelete={canDelete}
                    formatSize={formatFileSize}
                />
            );
        }

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
                            key={(item.data as BackupFolder).name}
                            name={(item.data as BackupFolder).name}
                            onClick={() => handlers.handleFolderClick(item.data as BackupFolder)}
                        />
                    ) : (
                        <FileCard
                            key={(item.data as BaseStoredFile).fullPath || idx}
                            name={(item.data as BaseStoredFile).name}
                            date={(item.data as BaseStoredFile).date}
                            shift={(item.data as StoredPdfFile).shiftType || 'day'}
                            size={formatFileSize((item.data as BaseStoredFile).size)}
                            onView={() => setPreviewFile(item.data as BaseStoredFile | StoredPdfFile)}
                            onDownload={() => handlers.handleDownload(item.data as BaseStoredFile | StoredPdfFile)}
                            onDelete={() => handlers.handleDelete(item.data as BaseStoredFile | StoredPdfFile)}
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
        <div className="space-y-6 animate-in fade-in duration-500">
            {/* Tabs for Backup Types */}
            <div className="flex gap-1 bg-white p-2 rounded-2xl shadow-sm border border-slate-100">
                {BACKUP_TABS.map(({ type, label, icon: Icon }) => (
                    <button
                        key={type}
                        onClick={() => handlers.changeBackupType(type)}
                        className={clsx(
                            "flex items-center gap-2 px-4 py-2.5 rounded-xl font-bold text-sm transition-all duration-200",
                            selectedBackupType === type
                                ? "bg-medical-600 text-white shadow-lg shadow-medical-100"
                                : "text-slate-500 hover:bg-slate-50"
                        )}
                    >
                        <Icon size={18} />
                        {label}
                    </button>
                ))}
            </div>

            {/* Header and Breadcrumbs */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white p-4 rounded-3xl shadow-sm border border-slate-100">
                <Breadcrumbs path={path} onNavigate={handlers.handleBreadcrumbNavigate} />

                <div className="flex items-center gap-2 shrink-0">
                    <div className="relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                        <input
                            type="text"
                            placeholder="Buscar en esta carpeta..."
                            className="pl-9 pr-4 py-2 bg-slate-50 border-none rounded-xl text-sm focus:ring-2 focus:ring-medical-500 w-full md:w-48 lg:w-64 font-medium"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                        />
                    </div>

                    <div className="flex bg-slate-50 p-1 rounded-xl">
                        <button
                            onClick={() => setViewMode('grid')}
                            className={clsx("p-1.5 rounded-lg transition-all", viewMode === 'grid' ? "bg-white shadow-sm text-medical-600" : "text-slate-400 hover:text-slate-600")}
                            aria-label="Vista cuadrícula"
                        >
                            <LayoutGrid size={18} />
                        </button>
                        <button
                            onClick={() => setViewMode('list')}
                            className={clsx("p-1.5 rounded-lg transition-all", viewMode === 'list' ? "bg-white shadow-sm text-medical-600" : "text-slate-400 hover:text-slate-600")}
                            aria-label="Vista lista"
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

            {/* Previews Orchestration */}
            {previewFile && (
                <>
                    {previewFile.name.endsWith('.xlsx') ? (
                        <ExcelViewerModal
                            fileName={previewFile.name}
                            downloadUrl={previewFile.downloadUrl}
                            onClose={() => setPreviewFile(null)}
                            onDownload={() => handlers.handleDownload(previewFile)}
                            canDownload={true}
                            subtitle={selectedBackupType === 'census' ? 'Censo Hospital Hanga Roa' : 'CUDYR Hospital Hanga Roa'}
                        />
                    ) : (
                        <PdfViewerModal
                            fileName={previewFile.name}
                            url={previewFile.downloadUrl}
                            onClose={() => setPreviewFile(null)}
                            onDownload={() => handlers.handleDownload(previewFile)}
                        />
                    )}
                </>
            )}
        </div>
    );
};

export default BackupFilesView;
