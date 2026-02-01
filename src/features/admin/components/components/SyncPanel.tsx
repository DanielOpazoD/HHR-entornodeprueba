import React from 'react';
import { RefreshCw, Activity, UploadCloud, CheckCircle } from 'lucide-react';
import { AnalysisResult } from '@/hooks/usePatientAnalysis';

interface SyncPanelProps {
    analysis: AnalysisResult | null;
    isAnalyzing: boolean;
    isMigrating: boolean;
    migrationResult: { successes: number; errors: number } | null;
    onRunAnalysis: () => void;
    onRunMigration: () => void;
}

export const SyncPanel: React.FC<SyncPanelProps> = ({
    analysis,
    isAnalyzing,
    isMigrating,
    migrationResult,
    onRunAnalysis,
    onRunMigration
}) => {
    return (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="p-5 bg-slate-50 rounded-2xl border border-slate-200 flex flex-col">
                <div className="flex items-center gap-3 mb-4">
                    <div className="p-2.5 bg-white rounded-xl shadow-sm border border-slate-200 text-slate-600">
                        <Activity size={20} />
                    </div>
                    <h3 className="font-bold text-slate-800 tracking-tight text-base">Análisis de Historial</h3>
                </div>

                <p className="text-xs text-slate-500 mb-6 leading-relaxed">
                    Escanea todos los registros diarios para reconstruir el historial clínico de cada paciente detectado.
                </p>

                {!analysis ? (
                    <button
                        onClick={onRunAnalysis}
                        disabled={isAnalyzing}
                        className="w-full py-3 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 font-bold rounded-xl text-sm transition-all flex items-center justify-center disabled:opacity-50 shadow-sm"
                    >
                        {isAnalyzing ? (
                            <RefreshCw className="mr-2 h-4 w-4 animate-spin text-blue-500" />
                        ) : (
                            <RefreshCw className="mr-2 h-4 w-4" />
                        )}
                        {isAnalyzing ? 'Analizando...' : 'Iniciar Análisis Retroactivo'}
                    </button>
                ) : (
                    <div className="space-y-4 flex-1">
                        <div className="grid grid-cols-2 gap-3">
                            <div className="bg-white p-3 rounded-xl border border-slate-200">
                                <div className="text-[10px] text-slate-400 uppercase font-black mb-1">Días</div>
                                <div className="text-xl font-black text-slate-800">{analysis.totalRecords}</div>
                            </div>
                            <div className="bg-white p-3 rounded-xl border border-slate-200">
                                <div className="text-[10px] text-slate-400 uppercase font-black mb-1">Pacientes</div>
                                <div className="text-xl font-black text-blue-600">{analysis.uniquePatients}</div>
                            </div>
                        </div>
                        <div className="p-3 bg-amber-50 border border-amber-100 rounded-xl flex justify-between items-center">
                            <span className="text-xs font-bold text-amber-800">Conflictos detectados:</span>
                            <span className="font-black text-amber-600 bg-white px-2 py-0.5 rounded-lg text-sm border border-amber-200">
                                {analysis.conflicts.length}
                            </span>
                        </div>
                        <button
                            onClick={onRunAnalysis}
                            className="w-full text-xs text-slate-400 hover:text-blue-500 font-bold underline transition-colors"
                        >
                            Repetir Análisis
                        </button>
                    </div>
                )}
            </div>

            <div className="p-5 bg-blue-600 rounded-2xl text-white shadow-xl shadow-blue-100 flex flex-col relative overflow-hidden">
                <div className="absolute top-0 right-0 w-32 h-32 bg-white/10 rounded-full -mr-16 -mt-16 blur-2xl" />

                <div className="flex items-center gap-3 mb-4 relative z-10">
                    <div className="p-2.5 bg-white/10 backdrop-blur-md rounded-xl border border-white/20 text-white">
                        <UploadCloud size={20} />
                    </div>
                    <h3 className="font-bold tracking-tight text-base">Persistencia en Cloud</h3>
                </div>

                <p className="text-xs text-blue-100 mb-6 leading-relaxed relative z-10">
                    Sincroniza los resultados del análisis con la base maestra global. Esto habilitará el autocompletado inteligente.
                </p>

                <button
                    onClick={onRunMigration}
                    disabled={!analysis || isMigrating || analysis.uniquePatients === 0}
                    className="w-full py-4 bg-white text-blue-600 font-black rounded-xl shadow-lg border-b-4 border-blue-100 hover:bg-blue-50 hover:translate-y-[-2px] active:translate-y-[1px] transition-all disabled:opacity-50 disabled:translate-y-0 relative z-10"
                >
                    {isMigrating ? (
                        <span className="flex items-center justify-center gap-2">
                            <RefreshCw className="animate-spin" size={20} /> Actualizando persistencia...
                        </span>
                    ) : (
                        <span className="flex items-center justify-center gap-2 uppercase tracking-tight">
                            Sincronizar Maestro {analysis?.uniquePatients ? `(${analysis.uniquePatients})` : ''}
                        </span>
                    )}
                </button>

                {migrationResult && (
                    <div className="mt-4 p-3 bg-blue-500/30 backdrop-blur rounded-xl border border-white/10 text-xs animate-in slide-in-from-bottom-2">
                        <div className="flex items-center gap-2 font-bold mb-1">
                            <CheckCircle size={14} /> Sincronización Exitosa
                        </div>
                        <p className="text-blue-50 text-[10px]">
                            {migrationResult.successes} pacientes actualizados.
                            {migrationResult.errors > 0 && ` Detectados ${migrationResult.errors} errores.`}
                        </p>
                    </div>
                )}
            </div>
        </div>
    );
};
