/**
 * Backup Files View (Google Drive style)
 * Main view for navigating and managing backup PDFs in Storage
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { FolderArchive, Plus, Search, LayoutGrid, List as ListIcon, RefreshCw, AlertCircle } from 'lucide-react';
import { useAuthState } from '@/hooks/useAuthState';
import { useNotification, useConfirmDialog } from '@/context/UIContext';
import {
    listYears,
    listMonths,
    listFilesInMonth,
    deletePdf,
    StoredPdfFile
} from '@/services/backup/pdfStorageService';
import {
    listCensusYears,
    listCensusMonths,
    listCensusFilesInMonth,
    deleteCensus,
    StoredCensusFile
} from '@/services/backup/censusStorageService';
import {
    listCudyrYears,
    listCudyrMonths,
    listCudyrFilesInMonth,
    StoredCudyrFile
} from '@/services/backup/cudyrStorageService';
import { Breadcrumbs, FolderCard, FileCard } from './components/BackupDriveItems';
import { HandoffCalendarView } from './components/HandoffCalendarView';
import { ExcelViewerModal } from '@/components/shared/ExcelViewerModal';
import { PdfViewerModal } from '@/components/shared/PdfViewerModal';

type NavPath = {
    year?: string;
    month?: { number: string; name: string };
};

type BackupType = 'handoff' | 'census' | 'cudyr';

export const BackupFilesView: React.FC = () => {
    const { role } = useAuthState();
    const { success, error, warning } = useNotification();
    const { confirm } = useConfirmDialog();
    const isAdmin = role === 'admin' || role === 'nurse_hospital';

    // State
    const [backupType, setBackupType] = useState<BackupType>('handoff');
    const [path, setPath] = useState<string[]>([]); // Array of folder names for breadcrumbs
    const [currentNav, setCurrentNav] = useState<NavPath>({});
    const [items, setItems] = useState<{ type: 'folder' | 'file', data: any }[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [searchQuery, setSearchQuery] = useState('');
    const [viewMode, setViewMode] = useState<'grid' | 'list'>('list');

    // Excel preview state for census files
    const [previewFile, setPreviewFile] = useState<StoredCensusFile | null>(null);

    // PDF preview state for handoff files
    const [previewPdf, setPreviewPdf] = useState<StoredPdfFile | null>(null);

    // Request ID ref to handle race conditions - ignore stale responses
    const requestIdRef = useRef(0);

    // Load content based on current path
    const loadContent = useCallback(async (currentRequestId: number) => {
        setIsLoading(true);
        try {
            if (path.length === 0) {
                // Root: List years
                let years: string[] = [];
                if (backupType === 'handoff') {
                    years = await listYears();
                } else if (backupType === 'census') {
                    years = await listCensusYears();
                } else {
                    years = await listCudyrYears();
                }
                // Check if this request is still current
                if (currentRequestId !== requestIdRef.current) return;
                setItems(years.map(year => ({
                    type: 'folder',
                    data: { name: year, type: 'year' }
                })));
            } else if (path.length === 1) {
                // Year: List months
                let months: { number: string; name: string }[] = [];
                if (backupType === 'handoff') {
                    months = await listMonths(path[0]);
                } else if (backupType === 'census') {
                    months = await listCensusMonths(path[0]);
                } else {
                    months = await listCudyrMonths(path[0]);
                }
                // Check if this request is still current
                if (currentRequestId !== requestIdRef.current) return;
                setItems(months.map(month => ({
                    type: 'folder',
                    data: { name: month.name, number: month.number, type: 'month' }
                })));
            } else if (path.length === 2) {
                // Month: List files
                if (backupType === 'handoff') {
                    const files = await listFilesInMonth(path[0], currentNav.month?.number || '');
                    // Check if this request is still current
                    if (currentRequestId !== requestIdRef.current) return;
                    setItems(files.map(file => ({
                        type: 'file',
                        data: file
                    })));
                } else if (backupType === 'census') {
                    const files = await listCensusFilesInMonth(path[0], currentNav.month?.number || '');
                    // Check if this request is still current
                    if (currentRequestId !== requestIdRef.current) return;
                    const sortedFiles = files.sort((a, b) => a.date.localeCompare(b.date));
                    setItems(sortedFiles.map(file => ({
                        type: 'file',
                        data: file
                    })));
                } else {
                    // CUDYR files
                    const files = await listCudyrFilesInMonth(path[0], currentNav.month?.number || '');
                    // Check if this request is still current
                    if (currentRequestId !== requestIdRef.current) return;
                    const sortedFiles = files.sort((a, b) => a.date.localeCompare(b.date));
                    setItems(sortedFiles.map(file => ({
                        type: 'file',
                        data: file
                    })));
                }
            }
        } catch (err) {
            console.error('Error loading backup content:', err);
            error('Error al cargar contenido de respaldos');
        } finally {
            setIsLoading(false);
        }
    }, [path, currentNav.month?.number, error, backupType]);

    // Auto-navigate to current year/month when backup type changes
    useEffect(() => {
        const now = new Date();
        const currentYear = now.getFullYear().toString();
        const currentMonthNum = String(now.getMonth() + 1).padStart(2, '0');
        const monthNames = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
            'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
        const currentMonthName = monthNames[now.getMonth()];

        // Navigate directly to current year/month
        setPath([currentYear, currentMonthName]);
        setCurrentNav({
            year: currentYear,
            month: { number: currentMonthNum, name: currentMonthName }
        });
    }, [backupType]);

    // Load content when path or backup type changes
    useEffect(() => {
        // Increment request ID to invalidate any pending requests
        requestIdRef.current += 1;
        const currentRequestId = requestIdRef.current;
        loadContent(currentRequestId);
    }, [path, backupType, loadContent]);

    // Navigation handlers
    const handleFolderClick = (folderData: any) => {
        if (folderData.type === 'year') {
            setPath([folderData.name]);
            setCurrentNav({ year: folderData.name });
        } else if (folderData.type === 'month') {
            setPath([path[0], folderData.name]);
            setCurrentNav(prev => ({ ...prev, month: { number: folderData.number, name: folderData.name } }));
        }
    };

    const handleBreadcrumbNavigate = (index: number) => {
        if (index === -1) {
            setPath([]);
            setCurrentNav({});
        } else if (index === 0) {
            setPath([path[0]]);
            setCurrentNav({ year: path[0] });
        }
    };

    const handleDownload = (file: any) => {
        const link = document.createElement('a');
        link.href = file.downloadUrl;
        link.download = file.name || 'documento';
        window.open(file.downloadUrl, '_blank'); // Keep original behavior for download button
    };

    const handlePreviewPdf = (file: StoredPdfFile) => {
        setPreviewPdf(file);
    };

    const handleDelete = async (file: any) => {
        const typeLabel = backupType === 'handoff' ? 'Respaldo' : backupType === 'census' ? 'Censo' : 'CUDYR';
        const confirmed = await confirm({
            title: `🗑️ Eliminar ${typeLabel}`,
            message: `¿Estás seguro de que deseas eliminar el archivo del día ${file.date}?\n\nEsta acción no se puede deshacer.`,
            confirmText: 'Eliminar',
            cancelText: 'Cancelar',
            variant: 'danger'
        });

        if (!confirmed) return;

        try {
            if (backupType === 'handoff') {
                await deletePdf(file.date, file.shiftType);
            } else if (backupType === 'census') {
                await deleteCensus(file.date);
            } else {
                // CUDYR: For now, we don't support delete (read-only archive)
                warning('Los archivos CUDYR no se pueden eliminar desde aquí');
                return;
            }
            success('Archivo eliminado correctamente');
            // Trigger a refresh
            requestIdRef.current += 1;
            loadContent(requestIdRef.current);
        } catch (err) {
            console.error('Error deleting file:', err);
            error('No se pudo eliminar el archivo');
        }
    };

    // Wrapper for refresh button
    const handleRefresh = useCallback(() => {
        requestIdRef.current += 1;
        loadContent(requestIdRef.current);
    }, [loadContent]);

    const formatSize = (bytes: number) => {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return Math.round(bytes / Math.pow(k, i)) + ' ' + sizes[i];
    };

    // Handler for previewing census Excel files
    const handlePreviewExcel = (file: StoredCensusFile) => {
        setPreviewFile(file);
    };


    // Filter items based on search
    const filteredItems = items.filter(item => {
        const name = item.type === 'folder' ? item.data.name : item.data.name;
        return name.toLowerCase().includes(searchQuery.toLowerCase());
    });

    return (
        <div className="max-w-6xl mx-auto p-4 sm:p-6">
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
                <div className="flex items-center gap-3">
                    <div className="w-12 h-12 bg-teal-100 rounded-2xl flex items-center justify-center text-teal-600 shadow-sm">
                        <FolderArchive size={28} />
                    </div>
                    <div>
                        <h1 className="text-2xl font-bold text-slate-800">Archivos</h1>
                        <p className="text-sm text-slate-500">
                            {backupType === 'handoff' ? 'Respaldos de Entregas de Turno' :
                                backupType === 'census' ? 'Respaldos de Censo Diario' :
                                    'Respaldos CUDYR Mensual'}
                        </p>
                    </div>
                </div>

                {/* Backup Type Selector */}
                <div className="flex bg-slate-100 p-1 rounded-lg">
                    <button
                        onClick={() => setBackupType('handoff')}
                        className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${backupType === 'handoff'
                            ? 'bg-white text-teal-700 shadow-sm'
                            : 'text-slate-600 hover:text-slate-900'
                            }`}
                    >
                        Entregas
                    </button>
                    <button
                        onClick={() => setBackupType('census')}
                        className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${backupType === 'census'
                            ? 'bg-white text-teal-700 shadow-sm'
                            : 'text-slate-600 hover:text-slate-900'
                            }`}
                    >
                        Censo
                    </button>
                    <button
                        onClick={() => setBackupType('cudyr')}
                        className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${backupType === 'cudyr'
                            ? 'bg-white text-emerald-700 shadow-sm'
                            : 'text-slate-600 hover:text-slate-900'
                            }`}
                    >
                        CUDYR
                    </button>
                </div>

                <div className="flex items-center gap-2">
                    <div className="relative flex-1 sm:w-64">
                        <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                        <input
                            type="text"
                            placeholder="Buscar en archivos..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="w-full pl-10 pr-4 py-2 bg-white border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 transition-all"
                        />
                    </div>
                    <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-xl">
                        <button
                            onClick={() => setViewMode('grid')}
                            className={`p-1.5 rounded-lg transition-colors ${viewMode === 'grid' ? 'bg-white shadow-sm text-teal-600' : 'text-slate-500 hover:text-slate-700'}`}
                        >
                            <LayoutGrid size={18} />
                        </button>
                        <button
                            onClick={() => setViewMode('list')}
                            className={`p-1.5 rounded-lg transition-colors ${viewMode === 'list' ? 'bg-white shadow-sm text-teal-600' : 'text-slate-500 hover:text-slate-700'}`}
                        >
                            <ListIcon size={18} />
                        </button>
                    </div>
                    <button
                        onClick={handleRefresh}
                        disabled={isLoading}
                        className="p-2 text-slate-500 hover:text-teal-600 hover:bg-teal-50 rounded-xl transition-all disabled:opacity-50"
                        title="Refrescar"
                    >
                        <RefreshCw size={20} className={isLoading ? 'animate-spin' : ''} />
                    </button>
                </div>
            </div>

            {/* Navigation & Breadcrumbs */}
            <div className="bg-white/50 backdrop-blur-sm border border-slate-200 rounded-2xl p-4 mb-6">
                <Breadcrumbs path={path} onNavigate={handleBreadcrumbNavigate} />

                {isLoading ? (
                    <div className="flex flex-col items-center justify-center py-20 text-slate-400">
                        <RefreshCw size={40} className="animate-spin mb-4 opacity-20" />
                        <p className="text-sm font-medium animate-pulse">Cargando elementos...</p>
                    </div>
                ) : filteredItems.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-20 bg-slate-50/50 rounded-xl border-2 border-dashed border-slate-200">
                        <AlertCircle size={40} className="text-slate-300 mb-2" />
                        <p className="text-slate-500 font-medium">No se encontraron elementos</p>
                        <p className="text-xs text-slate-400 mt-1">
                            {path.length === 0 ? 'Aún no hay respaldos guardados' : 'Esta carpeta está vacía'}
                        </p>
                    </div>
                ) : (
                    <>
                        {/* Calendar view for handoff files at month level */}
                        {backupType === 'handoff' && path.length === 2 && filteredItems.some(i => i.type === 'file') ? (
                            <HandoffCalendarView
                                files={filteredItems.filter(i => i.type === 'file').map(i => i.data)}
                                onDownload={handleDownload}
                                onView={handlePreviewPdf}
                                onDelete={handleDelete}
                                canDelete={isAdmin}
                                formatSize={formatSize}
                            />
                        ) : (
                            <div className={viewMode === 'grid'
                                ? "grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4"
                                : "flex flex-col gap-2"
                            }>
                                {filteredItems.map((item, idx) => (
                                    item.type === 'folder' ? (
                                        <FolderCard
                                            key={idx}
                                            name={item.data.name}
                                            onClick={() => handleFolderClick(item.data)}
                                        />
                                    ) : (
                                        <FileCard
                                            key={idx}
                                            name={item.data.name}
                                            date={item.data.date}
                                            shift={item.data.shiftType}
                                            size={formatSize(item.data.size)}
                                            onDownload={() => handleDownload(item.data)}
                                            onView={(backupType === 'census' || backupType === 'cudyr')
                                                ? () => handlePreviewExcel(item.data)
                                                : () => handlePreviewPdf(item.data)}
                                            onDelete={() => handleDelete(item.data)}
                                            canDelete={isAdmin && backupType !== 'cudyr'}
                                        />
                                    )
                                ))}
                            </div>
                        )}
                    </>
                )}
            </div>

            {/* Empty State Help */}
            {path.length === 0 && !isLoading && items.length > 0 && (
                <div className="mt-8 p-4 bg-teal-50/50 border border-teal-100 rounded-2xl flex gap-4">
                    <div className="p-2 bg-teal-100 text-teal-600 rounded-xl self-start">
                        <AlertCircle size={20} />
                    </div>
                    <div>
                        <h4 className="text-sm font-bold text-teal-800">Sistema de Respaldos en la Nube</h4>
                        <p className="text-xs text-teal-700 mt-1 leading-relaxed">
                            Los archivos se organizan automáticamente por año y mes. Para generar un respaldo, utiliza el botón <b>"Guardar Respaldo PDF"</b> en la vista de Entrega de Turno. Solo se permiten 2 respaldos por día (Largo/Noche).
                        </p>
                    </div>
                </div>
            )}

            {/* Excel Preview Modal for Census Files */}
            {previewFile && (
                <ExcelViewerModal
                    fileName={previewFile.date}
                    downloadUrl={previewFile.downloadUrl}
                    canDownload={true}
                    onClose={() => setPreviewFile(null)}
                    onDownload={() => window.open(previewFile.downloadUrl, '_blank')}
                    subtitle="Censo Diario Hospital Hanga Roa"
                />
            )}

            {/* PDF Preview Modal for Handoff Files */}
            {previewPdf && (
                <PdfViewerModal
                    fileName={`Entrega ${previewPdf.date} - ${previewPdf.shiftType === 'day' ? 'Largo' : 'Noche'}`}
                    url={previewPdf.downloadUrl}
                    onClose={() => setPreviewPdf(null)}
                    onDownload={() => handleDownload(previewPdf)}
                />
            )}
        </div>
    );
};

export default BackupFilesView;
