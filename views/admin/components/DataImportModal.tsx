import React, { useState } from 'react';
import { X, Upload, FileJson, CheckCircle2, AlertCircle, Loader2 } from 'lucide-react';
import { MonthBackup, validateBackupFile, importRecordsFromBackup } from '@/services/admin/dataMaintenanceService';


interface DataImportModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSuccess: () => void;
}

export const DataImportModal: React.FC<DataImportModalProps> = ({ isOpen, onClose, onSuccess }) => {
    const [file, setFile] = useState<File | null>(null);
    const [backupData, setBackupData] = useState<MonthBackup | null>(null);
    const [status, setStatus] = useState<'IDLE' | 'READING' | 'VALIDATED' | 'IMPORTING' | 'SUCCESS' | 'ERROR'>('IDLE');
    const [progress, setProgress] = useState({ current: 0, total: 0 });
    const [results, setResults] = useState({ success: 0, failed: 0 });
    const [error, setError] = useState<string | null>(null);

    if (!isOpen) return null;

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const selectedFile = e.target.files?.[0];
        if (!selectedFile) return;

        setFile(selectedFile);
        setStatus('READING');
        setError(null);

        const reader = new FileReader();
        reader.onload = (event) => {
            try {
                const content = JSON.parse(event.target?.result as string);
                if (validateBackupFile(content)) {
                    setBackupData(content);
                    setStatus('VALIDATED');
                } else {
                    setError('El archivo no tiene el formato de respaldo válido de HospitalizadosHHR.');
                    setStatus('ERROR');
                }
            } catch (_err) {
                setError('Error al leer el archivo JSON. Asegúrese de que sea un archivo válido.');
                setStatus('ERROR');
            }
        };
        reader.readAsText(selectedFile);
    };

    const handleImport = async () => {
        if (!backupData) return;

        setStatus('IMPORTING');
        try {
            const res = await importRecordsFromBackup(backupData, (current, total) => {
                setProgress({ current, total });
            });
            setResults(res);
            setStatus('SUCCESS');
            onSuccess();
        } catch (_err) {
            setError('Error crítico durante la importación. Algunos datos pueden no haberse guardado.');
            setStatus('ERROR');
        }
    };

    const reset = () => {
        setFile(null);
        setBackupData(null);
        setStatus('IDLE');
        setProgress({ current: 0, total: 0 });
        setError(null);
    };

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fade-in">
            <div className="bg-white rounded-3xl shadow-2xl w-full max-w-lg overflow-hidden border border-slate-200">
                {/* Header */}
                <div className="px-6 py-5 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-indigo-100 flex items-center justify-center">
                            <Upload className="text-indigo-600" size={20} />
                        </div>
                        <div>
                            <h3 className="text-lg font-bold text-slate-800">Importar Respaldo</h3>
                            <p className="text-xs text-slate-500">Restaurar registros desde archivo JSON</p>
                        </div>
                    </div>
                    <button onClick={onClose} className="p-2 hover:bg-slate-200 rounded-full transition-colors">
                        <X size={20} className="text-slate-400" />
                    </button>
                </div>

                <div className="p-8">
                    {/* IDLE state */}
                    {status === 'IDLE' && (
                        <div className="flex flex-col items-center justify-center border-2 border-dashed border-slate-200 rounded-2xl p-10 hover:border-indigo-300 transition-colors bg-slate-50/30 group">
                            <input
                                type="file"
                                accept=".json"
                                onChange={handleFileChange}
                                className="hidden"
                                id="backup-upload"
                            />
                            <label htmlFor="backup-upload" className="cursor-pointer flex flex-col items-center">
                                <div className="w-16 h-16 rounded-full bg-indigo-50 flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                                    <FileJson className="text-indigo-500" size={32} />
                                </div>
                                <p className="text-sm font-bold text-slate-700">Seleccionar archivo .json</p>
                                <p className="text-xs text-slate-400 mt-1">Suelte el archivo aquí o haga clic para buscar</p>
                            </label>
                        </div>
                    )}

                    {/* READING / VALIDATED state */}
                    {(status === 'READING' || status === 'VALIDATED') && backupData && (
                        <div className="space-y-6">
                            <div className="bg-indigo-50/50 border border-indigo-100 rounded-2xl p-4 flex items-start gap-4">
                                <div className="p-2 bg-white rounded-lg shadow-sm">
                                    <FileJson className="text-indigo-600" size={24} />
                                </div>
                                <div className="flex-1">
                                    <p className="text-sm font-bold text-slate-800">{file?.name}</p>
                                    <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1 text-[11px] font-medium text-slate-500">
                                        <span>📂 Mes: {backupData.month}/{backupData.year}</span>
                                        <span>📝 Registros: {backupData.recordCount} días</span>
                                    </div>
                                </div>
                                <CheckCircle2 className="text-emerald-500" size={20} />
                            </div>

                            <div className="bg-amber-50 border border-amber-100 p-4 rounded-xl flex items-start gap-3">
                                <AlertCircle className="text-amber-600 shrink-0" size={18} />
                                <p className="text-xs text-amber-800 leading-relaxed">
                                    <strong>Atención:</strong> La importación sobrescribirá los datos locales y remotos para los días incluidos en el archivo. Asegúrese de que este respaldo sea el correcto.
                                </p>
                            </div>

                            <div className="flex gap-3">
                                <button
                                    onClick={reset}
                                    className="flex-1 py-3 px-4 rounded-xl border border-slate-200 text-sm font-bold text-slate-600 hover:bg-slate-50 transition-colors"
                                >
                                    Cancelar
                                </button>
                                <button
                                    onClick={handleImport}
                                    className="flex-[2] py-3 px-4 rounded-xl bg-indigo-600 text-sm font-bold text-white shadow-lg shadow-indigo-200 hover:bg-indigo-700 transition-all"
                                >
                                    Iniciar Importación
                                </button>
                            </div>
                        </div>
                    )}

                    {/* IMPORTING state */}
                    {status === 'IMPORTING' && (
                        <div className="flex flex-col items-center py-6">
                            <div className="relative w-24 h-24 flex items-center justify-center mb-6">
                                <Loader2 className="text-indigo-600 animate-spin" size={48} />
                                <span className="absolute text-xs font-bold text-slate-600">
                                    {Math.round((progress.current / progress.total) * 100)}%
                                </span>
                            </div>
                            <h4 className="text-lg font-bold text-slate-800">Procesando registros</h4>
                            <p className="text-sm text-slate-500 mt-1">Importando {progress.current} de {progress.total} días...</p>

                            <div className="w-full h-2 bg-slate-100 rounded-full mt-6 overflow-hidden">
                                <div
                                    className="h-full bg-indigo-500 transition-all duration-300"
                                    style={{ width: `${(progress.current / progress.total) * 100}%` }}
                                />
                            </div>
                        </div>
                    )}

                    {/* SUCCESS state */}
                    {status === 'SUCCESS' && (
                        <div className="flex flex-col items-center py-6 text-center">
                            <div className="w-20 h-20 rounded-full bg-emerald-100 flex items-center justify-center mb-6 animate-bounce">
                                <CheckCircle2 className="text-emerald-600" size={40} />
                            </div>
                            <h4 className="text-xl font-bold text-slate-800">¡Importación Exitosa!</h4>
                            <p className="text-sm text-slate-500 mt-2">
                                Se han restaurado <strong>{results.success}</strong> registros correctamente.
                                {results.failed > 0 && ` (${results.failed} fallidos)`}
                            </p>
                            <button
                                onClick={onClose}
                                className="mt-8 w-full py-3 bg-slate-900 text-white rounded-xl font-bold shadow-lg shadow-slate-200 hover:bg-slate-800 transition-colors"
                            >
                                Entendido
                            </button>
                        </div>
                    )}

                    {/* ERROR state */}
                    {status === 'ERROR' && (
                        <div className="flex flex-col items-center py-6 text-center">
                            <div className="w-20 h-20 rounded-full bg-rose-100 flex items-center justify-center mb-6">
                                <AlertCircle className="text-rose-600" size={40} />
                            </div>
                            <h4 className="text-xl font-bold text-slate-800">Error en la operación</h4>
                            <p className="text-sm text-rose-600 mt-2 font-medium">{error}</p>
                            <button
                                onClick={reset}
                                className="mt-8 w-full py-3 bg-slate-100 text-slate-700 rounded-xl font-bold hover:bg-slate-200 transition-colors"
                            >
                                Intentar de nuevo
                            </button>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};
