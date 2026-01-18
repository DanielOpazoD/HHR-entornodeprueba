import React, { useState } from 'react';
import { Database, Download, Upload, Calendar, AlertCircle, Info, ShieldCheck, FileJson, ChevronDown } from 'lucide-react';
import { exportMonthRecords } from '@/services/admin/dataMaintenanceService';
import { DataImportModal } from './DataImportModal';
import clsx from 'clsx';

interface DataMaintenancePanelProps {
    onDailyExport?: () => void;
    onDailyImport?: () => void;
}

export const DataMaintenancePanel: React.FC<DataMaintenancePanelProps> = ({
    onDailyExport,
    onDailyImport
}) => {
    const [isExporting, setIsExporting] = useState(false);
    const [showImportModal, setShowImportModal] = useState(false);
    const [exportError, setExportError] = useState<string | null>(null);
    const [exportSuccess, setExportSuccess] = useState(false);

    const now = new Date();
    const [selectedYear, setSelectedYear] = useState(now.getFullYear());
    const [selectedMonth, setSelectedMonth] = useState(now.getMonth() + 1);

    const years = Array.from({ length: 5 }, (_, i) => now.getFullYear() - i);
    const months = [
        { value: 1, label: 'Enero' },
        { value: 2, label: 'Febrero' },
        { value: 3, label: 'Marzo' },
        { value: 4, label: 'Abril' },
        { value: 5, label: 'Mayo' },
        { value: 6, label: 'Junio' },
        { value: 7, label: 'Julio' },
        { value: 8, label: 'Agosto' },
        { value: 9, label: 'Septiembre' },
        { value: 10, label: 'Octubre' },
        { value: 11, label: 'Noviembre' },
        { value: 12, label: 'Diciembre' }
    ];

    const handleExport = async () => {
        setIsExporting(true);
        setExportError(null);
        setExportSuccess(false);
        try {
            await exportMonthRecords(selectedYear, selectedMonth);
            setExportSuccess(true);
            setTimeout(() => setExportSuccess(false), 5000);
        } catch (err) {
            setExportError(err instanceof Error ? err.message : 'Error desconocido al exportar');
        } finally {
            setIsExporting(false);
        }
    };

    return (
        <div className="space-y-6 animate-fade-in">


            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Export Card */}
                <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 hover:shadow-md transition-all flex flex-col">
                    <div className="w-10 h-10 rounded-xl bg-emerald-100 flex items-center justify-center mb-4">
                        <Download className="text-emerald-600" size={20} />
                    </div>
                    <h3 className="text-base font-bold text-slate-800 mb-1">Exportar Respaldo Mensual</h3>
                    <p className="text-[11px] text-slate-500 mb-4 leading-relaxed">
                        Selecciona el periodo y descarga todos los registros en un archivo JSON seguro.
                    </p>

                    <div className="grid grid-cols-2 gap-3 mb-6">
                        <div className="space-y-1.5">
                            <label className="text-[10px] font-black uppercase tracking-wider text-slate-400 ml-1">Año</label>
                            <div className="relative">
                                <select
                                    value={selectedYear}
                                    onChange={(e) => setSelectedYear(parseInt(e.target.value))}
                                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm font-bold text-slate-700 appearance-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 outline-none transition-all"
                                >
                                    {years.map(y => <option key={y} value={y}>{y}</option>)}
                                </select>
                                <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" size={14} />
                            </div>
                        </div>
                        <div className="space-y-1.5">
                            <label className="text-[10px] font-black uppercase tracking-wider text-slate-400 ml-1">Mes</label>
                            <div className="relative">
                                <select
                                    value={selectedMonth}
                                    onChange={(e) => setSelectedMonth(parseInt(e.target.value))}
                                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm font-bold text-slate-700 appearance-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 outline-none transition-all"
                                >
                                    {months.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                                </select>
                                <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" size={14} />
                            </div>
                        </div>
                    </div>

                    <div className="mt-auto space-y-4">
                        {exportError && (
                            <div className="flex items-center gap-2 p-3 bg-rose-50 text-rose-700 rounded-xl text-xs font-bold border border-rose-100">
                                <AlertCircle size={14} />
                                {exportError}
                            </div>
                        )}
                        {exportSuccess && (
                            <div className="flex items-center gap-2 p-3 bg-emerald-50 text-emerald-700 rounded-xl text-xs font-bold border border-emerald-100">
                                <ShieldCheck size={14} />
                                Respaldo generado correctamente
                            </div>
                        )}
                        <button
                            onClick={handleExport}
                            disabled={isExporting}
                            className={clsx(
                                "w-full py-4 px-6 rounded-2xl font-bold flex items-center justify-center gap-2 transition-all shadow-lg",
                                isExporting
                                    ? "bg-slate-100 text-slate-400 cursor-not-allowed"
                                    : "bg-emerald-600 text-white shadow-emerald-100 hover:bg-emerald-700 hover:scale-[1.02] active:scale-95"
                            )}
                        >
                            {isExporting ? <Database className="animate-spin" size={20} /> : <FileJson size={20} />}
                            {isExporting ? 'Procesando...' : 'Descargar JSON'}
                        </button>
                    </div>
                </div>

                {/* Import Card */}
                <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 hover:shadow-md transition-all flex flex-col">
                    <div className="w-10 h-10 rounded-xl bg-indigo-100 flex items-center justify-center mb-4">
                        <Upload className="text-indigo-600" size={20} />
                    </div>
                    <h3 className="text-base font-bold text-slate-800 mb-1">Importar Respaldo Mensual</h3>
                    <p className="text-[11px] text-slate-500 mb-6 leading-relaxed">
                        Carga un archivo de respaldo generado anteriormente para restaurar los datos de un mes específico.
                    </p>

                    <div className="mt-auto">
                        <button
                            onClick={() => setShowImportModal(true)}
                            className="w-full py-4 px-6 rounded-2xl bg-slate-900 font-bold text-white flex items-center justify-center gap-2 transition-all shadow-lg shadow-slate-200 hover:bg-slate-800 hover:scale-[1.02] active:scale-95"
                        >
                            <Upload size={20} />
                            Seleccionar Archivo
                        </button>
                    </div>
                </div>

                {/* Daily Backup - New Section */}
                <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 hover:shadow-md transition-all flex flex-col md:col-span-2">
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                        <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-xl bg-blue-100 flex items-center justify-center shrink-0">
                                <FileJson className="text-blue-600" size={20} />
                            </div>
                            <div>
                                <h3 className="text-base font-bold text-slate-800 leading-none mb-1.5">Respaldo de Seguridad Instantáneo</h3>
                                <p className="text-[11px] text-slate-500 max-w-md">
                                    Respalda o restaura el censo completo del día actual de forma rápida.
                                </p>
                            </div>
                        </div>

                        <div className="flex flex-wrap items-center gap-3">
                            <button
                                onClick={onDailyExport}
                                className="px-6 py-3 rounded-xl bg-blue-600 text-white font-bold text-sm flex items-center gap-2 hover:bg-blue-700 transition-all shadow-md shadow-blue-100"
                            >
                                <Download size={16} />
                                Exportar Día
                            </button>
                            <button
                                onClick={onDailyImport}
                                className="px-6 py-3 rounded-xl bg-slate-100 text-slate-700 font-bold text-sm flex items-center gap-2 hover:bg-slate-200 transition-all border border-slate-200"
                            >
                                <Upload size={16} />
                                Importar día
                            </button>
                        </div>
                    </div>
                </div>
            </div>

            {/* Warning Section */}
            <div className="bg-amber-50 border-2 border-amber-100 rounded-3xl p-6 flex items-start gap-4">
                <div className="w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center shrink-0">
                    <Info className="text-amber-600" size={20} />
                </div>
                <div>
                    <h4 className="text-sm font-bold text-amber-900 mb-1">Información Importante</h4>
                    <p className="text-xs text-amber-800 leading-relaxed">
                        Estos archivos JSON contienen información clínica sensible. Deben ser almacenados en ubicaciones seguras y protegidas.
                        Al importar, el sistema sincronizará automáticamente los datos con la base de datos central de Firebase,
                        lo que actualizará la información para todos los usuarios.
                    </p>
                </div>
            </div>

            {/* Modals */}
            <DataImportModal
                isOpen={showImportModal}
                onClose={() => setShowImportModal(false)}
                onSuccess={() => {
                    // Could trigger a global refresh if needed
                }}
            />
        </div>
    );
};
