import React, { useState } from 'react';
import { Database, Download, Upload, Calendar, AlertCircle, Info, ShieldCheck, FileJson, ChevronDown } from 'lucide-react';
import { exportMonthRecords } from '../../../services/admin/dataMaintenanceService';
import { DataImportModal } from './DataImportModal';
import clsx from 'clsx';

export const DataMaintenancePanel: React.FC = () => {
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
            {/* Header / Intro */}
            <div className="bg-white rounded-3xl shadow-sm border border-slate-200 p-8 flex flex-col md:flex-row items-start md:items-center justify-between gap-6 overflow-hidden relative">
                <div className="absolute top-0 right-0 w-64 h-64 bg-slate-50 rounded-full -mr-32 -mt-32 opacity-50 pointer-events-none" />

                <div className="flex items-center gap-5 relative z-10">
                    <div className="w-16 h-16 rounded-2xl bg-slate-900 flex items-center justify-center shadow-lg shadow-slate-200 shrink-0">
                        <Database className="text-white" size={32} />
                    </div>
                    <div>
                        <h2 className="text-2xl font-black text-slate-800 tracking-tight">Mantenimiento de Datos</h2>
                        <p className="text-slate-500 font-medium">Gestión de respaldos locales y restauración de censo</p>
                    </div>
                </div>

                <div className="flex items-center gap-3 relative z-10">
                    <div className="flex -space-x-2">
                        {[1, 2, 3].map(i => (
                            <div key={i} className="w-8 h-8 rounded-full border-2 border-white bg-slate-100 flex items-center justify-center">
                                <ShieldCheck size={14} className="text-slate-400" />
                            </div>
                        ))}
                    </div>
                    <span className="text-xs font-bold text-slate-400 uppercase tracking-widest">Protección multinivel</span>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Export Card */}
                <div className="bg-white rounded-3xl shadow-sm border border-slate-200 p-8 hover:shadow-md transition-all flex flex-col">
                    <div className="w-12 h-12 rounded-xl bg-emerald-100 flex items-center justify-center mb-6">
                        <Download className="text-emerald-600" size={24} />
                    </div>
                    <h3 className="text-lg font-bold text-slate-800 mb-2">Exportar Respaldo Mensual</h3>
                    <p className="text-sm text-slate-500 mb-6 leading-relaxed">
                        Selecciona el periodo y descarga todos los registros en un archivo JSON seguro.
                    </p>

                    <div className="grid grid-cols-2 gap-4 mb-8">
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
                <div className="bg-white rounded-3xl shadow-sm border border-slate-200 p-8 hover:shadow-md transition-all flex flex-col">
                    <div className="w-12 h-12 rounded-xl bg-indigo-100 flex items-center justify-center mb-6">
                        <Upload className="text-indigo-600" size={24} />
                    </div>
                    <h3 className="text-lg font-bold text-slate-800 mb-2">Importar Respaldo</h3>
                    <p className="text-sm text-slate-500 mb-8 leading-relaxed">
                        Carga un archivo de respaldo generado anteriormente para restaurar los datos de un mes específico. Se requiere confirmación de administrador.
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
