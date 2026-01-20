/**
 * SharedCensusView
 * 
 * View for external users (invited guests) to access census files.
 * Displays the most recent file from current month and last file from previous month.
 * 
 * Refactored to use ExcelViewerModal for Excel viewing functionality.
 */

import React, { useState, useEffect } from 'react';
import {
    Download,
    FileSpreadsheet,
    Clock,
    AlertCircle,
    Loader2,
    Search,
    ShieldCheck,
    Eye
} from 'lucide-react';
import { listCensusFilesInMonth, StoredCensusFile } from '@/services/backup/censusStorageService';
import { logAccess } from '@/services/census/censusAccessService';
import { formatFileSize, MONTH_NAMES } from '@/services/backup/baseStorageService';
import { CensusAccessUser } from '@/types/censusAccess';
import { ExcelViewerModal } from '@/components/shared/ExcelViewerModal';
import clsx from 'clsx';

// ============================================================================
// Types
// ============================================================================

interface SharedCensusViewProps {
    accessUser: CensusAccessUser | null;
    error: string | null;
}

// ============================================================================
// Component
// ============================================================================

export const SharedCensusView: React.FC<SharedCensusViewProps> = ({ accessUser, error }) => {
    const [files, setFiles] = useState<StoredCensusFile[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [searchTerm, setSearchTerm] = useState('');

    // Selected file for viewing
    const [selectedFile, setSelectedFile] = useState<StoredCensusFile | null>(null);

    // Fetch files on mount
    useEffect(() => {
        if (!accessUser) return;

        async function fetchFiles() {
            setIsLoading(true);
            try {
                const now = new Date();
                const currentMonth = now.getMonth();
                const currentYear = now.getFullYear();

                let prevMonth = currentMonth - 1;
                let prevYear = currentYear;
                if (prevMonth < 0) {
                    prevMonth = 11;
                    prevYear--;
                }

                const currentMonthNum = String(currentMonth + 1).padStart(2, '0');
                const prevMonthNum = String(prevMonth + 1).padStart(2, '0');

                // Fetch files for both months
                const [currentFiles, prevFiles] = await Promise.all([
                    listCensusFilesInMonth(currentYear.toString(), currentMonthNum),
                    listCensusFilesInMonth(prevYear.toString(), prevMonthNum)
                ]);

                // Logic: Latest of current month + Last of previous month
                const selectedFiles: StoredCensusFile[] = [];

                if (currentFiles.length > 0) {
                    const sortedCurrent = [...currentFiles].sort((a, b) => b.date.localeCompare(a.date));
                    selectedFiles.push(sortedCurrent[0]);
                }

                if (prevFiles.length > 0) {
                    const sortedPrev = [...prevFiles].sort((a, b) => b.date.localeCompare(a.date));
                    selectedFiles.push(sortedPrev[0]);
                }

                setFiles(selectedFiles);

                logAccess({
                    userId: accessUser!.id,
                    email: accessUser!.email,
                    action: 'list_files'
                });

            } catch (err: unknown) {
                console.error('[SharedCensusView] Error fetching files:', err);
                setLoadError('No se pudieron cargar los archivos del censo.');
            } finally {
                setIsLoading(false);
            }
        }

        fetchFiles();
    }, [accessUser]);

    const handleDownload = async (file: StoredCensusFile) => {
        if (accessUser?.role !== 'downloader') {
            alert('No tienes permisos de descarga. Contacta al administrador si necesitas el archivo.');
            return;
        }

        try {
            logAccess({
                userId: accessUser!.id,
                email: accessUser!.email,
                action: 'download_file',
                filePath: file.fullPath,
                fileName: file.name
            });

            window.open(file.downloadUrl, '_blank');
        } catch (err) {
            console.error('Download error:', err);
            alert('Error al intentar descargar el archivo.');
        }
    };

    const handleViewFile = (file: StoredCensusFile) => {
        logAccess({
            userId: accessUser!.id,
            email: accessUser!.email,
            action: 'view_file',
            filePath: file.fullPath,
            fileName: file.name
        });

        setSelectedFile(file);
    };

    const filteredFiles = files.filter(f =>
        f.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        f.date.includes(searchTerm)
    );

    // Error state - no access
    if (error || (!accessUser && !isLoading)) {
        return (
            <div className="max-w-4xl mx-auto mt-20 p-8 bg-white rounded-3xl shadow-xl border border-red-100 text-center">
                <div className="w-20 h-20 bg-red-50 rounded-full flex items-center justify-center mx-auto mb-6 text-red-500">
                    <AlertCircle size={40} />
                </div>
                <h2 className="text-2xl font-bold text-slate-800 mb-4">Acceso Denegado</h2>
                <p className="text-slate-600 mb-8 max-w-md mx-auto">
                    {error || 'No tienes una invitación válida o tu sesión ha expirado.'}
                </p>
                <div className="text-sm text-slate-400">
                    Contacta al administrador para solicitar un nuevo link.
                </div>
            </div>
        );
    }

    // Loading state
    if (isLoading) {
        return (
            <div className="max-w-4xl mx-auto mt-20 flex flex-col items-center justify-center p-12 bg-white rounded-3xl shadow-md border border-slate-100">
                <Loader2 className="w-12 h-12 text-medical-600 animate-spin mb-4" />
                <p className="text-slate-600 font-medium">Cargando censo compartido...</p>
            </div>
        );
    }

    return (
        <div className="max-w-6xl mx-auto px-4 py-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
            {/* Header */}
            <header className="mb-6 flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
                <div>
                    <h1 className="text-2xl font-bold text-slate-900">Archivos de Censo Diario</h1>
                    <p className="text-slate-500 text-sm">
                        Bienvenido, <span className="text-slate-800 font-semibold">{accessUser!.displayName || accessUser!.email}</span>
                        <span className="mx-2 text-slate-300">|</span>
                        <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Acceso Compartido</span>
                    </p>
                </div>

                <div className="relative group">
                    <div className="absolute inset-y-0 left-3 flex items-center pointer-events-none text-slate-400 group-focus-within:text-medical-600 transition-colors">
                        <Search size={18} />
                    </div>
                    <input
                        type="text"
                        placeholder="Buscar por fecha..."
                        className="pl-10 pr-4 py-3 bg-white border border-slate-200 rounded-2xl w-full md:w-80 shadow-sm focus:ring-2 focus:ring-medical-500/20 focus:border-medical-500 outline-none transition-all"
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                    />
                </div>
            </header>

            {/* Content */}
            {loadError ? (
                <div className="bg-amber-50 border border-amber-200 rounded-2xl p-6 text-center text-amber-800">
                    <AlertCircle className="mx-auto mb-2" size={32} />
                    <p>{loadError}</p>
                </div>
            ) : filteredFiles.length === 0 ? (
                <div className="bg-white rounded-3xl shadow-sm border border-slate-100 p-16 text-center">
                    <div className="w-16 h-16 bg-slate-50 rounded-full flex items-center justify-center mx-auto mb-4 text-slate-300">
                        <FileSpreadsheet size={32} />
                    </div>
                    <h3 className="text-lg font-bold text-slate-700">No se encontraron archivos</h3>
                    <p className="text-slate-500 text-sm mt-1">
                        {searchTerm ? 'Prueba con otra búsqueda.' : 'No hay censos registrados.'}
                    </p>
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-4xl mx-auto">
                    {filteredFiles.map((file) => {
                        const [year, month, day] = file.date.split('-');
                        const monthName = MONTH_NAMES[parseInt(month) - 1];
                        const isCurrentMonth = new Date().getMonth() === parseInt(month) - 1;

                        return (
                            <div
                                key={file.fullPath}
                                className={clsx(
                                    "group bg-white rounded-3xl border p-6 transition-all flex flex-col justify-between relative overflow-hidden",
                                    isCurrentMonth
                                        ? "border-medical-200 shadow-md ring-1 ring-medical-50"
                                        : "border-slate-200 shadow-sm opacity-90"
                                )}
                            >
                                {isCurrentMonth && (
                                    <div className="absolute top-0 right-0 px-4 py-1.5 bg-medical-500 text-white text-[9px] font-bold uppercase tracking-widest rounded-bl-xl">
                                        Más Reciente
                                    </div>
                                )}

                                <div className="flex items-start justify-between mb-6">
                                    <div className={clsx(
                                        "w-14 h-14 rounded-2xl flex items-center justify-center border transition-colors",
                                        isCurrentMonth ? "bg-medical-50 text-medical-600 border-medical-100" : "bg-slate-50 text-slate-500 border-slate-100"
                                    )}>
                                        <FileSpreadsheet size={28} />
                                    </div>
                                    <div className="text-right">
                                        <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider mb-1">Censo Cerrado</p>
                                        <div className="flex items-center justify-end gap-1.5 text-slate-400">
                                            <ShieldCheck size={12} className="text-green-500" />
                                            <span className="text-[10px] font-medium">{formatFileSize(file.size)}</span>
                                        </div>
                                    </div>
                                </div>

                                <div className="mb-8">
                                    <h3 className="text-xl font-extrabold text-slate-900 mb-1">
                                        {monthName} {year}
                                    </h3>
                                    <div className="flex items-center gap-2 text-slate-500">
                                        <Clock size={14} className="text-slate-300" />
                                        <span className="text-sm font-medium">Corte: {day} de {monthName}</span>
                                    </div>
                                </div>

                                <div className="flex items-center gap-3">
                                    <button
                                        onClick={() => handleViewFile(file)}
                                        className={clsx(
                                            "flex-1 font-bold py-3 px-4 rounded-xl text-sm transition-all flex items-center justify-center gap-2 active:scale-95 border shadow-sm",
                                            isCurrentMonth
                                                ? "bg-medical-600 hover:bg-medical-700 text-white border-medical-500"
                                                : "bg-white hover:bg-slate-50 text-slate-700 border-slate-200"
                                        )}
                                    >
                                        <Eye size={18} />
                                        Visualizar Censo
                                    </button>

                                    {accessUser?.role === 'downloader' && (
                                        <button
                                            onClick={() => handleDownload(file)}
                                            className="w-12 h-12 bg-white hover:bg-slate-50 text-slate-500 font-bold rounded-xl text-sm transition-all flex items-center justify-center border border-slate-200 shadow-sm active:scale-95"
                                            title="Descargar"
                                        >
                                            <Download size={20} />
                                        </button>
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}

            {/* Excel Viewer Modal */}
            {selectedFile && (
                <ExcelViewerModal
                    fileName={selectedFile.name.split(' - ')[0]}
                    downloadUrl={selectedFile.downloadUrl}
                    canDownload={accessUser?.role === 'downloader'}
                    onClose={() => setSelectedFile(null)}
                    onDownload={() => handleDownload(selectedFile)}
                />
            )}

            {/* Footer */}
            <footer className="mt-12 pt-8 border-t border-slate-100 text-center text-slate-400">
                <div className="flex items-center justify-center gap-4 mb-4">
                    <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest">
                        <Clock size={14} />
                        Histórico Estratégico
                    </div>
                </div>
                <p className="text-[10px] max-w-lg mx-auto leading-relaxed">
                    Este sistema contiene información sensible protegida por la Ley 19.628.
                    Todas las acciones de acceso y descarga son registradas con fines de auditoría.
                </p>
            </footer>
        </div>
    );
};
