import React, { useState } from 'react';
import { Database, AlertTriangle, CheckCircle2, Loader2, ChevronRight, BarChart3, Trash2 } from 'lucide-react';
import { previewConsolidation, executeConsolidation, ConsolidationPreview, ConsolidationResult } from '../../../../services/admin/auditConsolidationService';
import clsx from 'clsx';

export const ConsolidationManager: React.FC = () => {
    const [loading, setLoading] = useState(false);
    const [preview, setPreview] = useState<ConsolidationPreview | null>(null);
    const [result, setResult] = useState<ConsolidationResult | null>(null);
    const [progress, setProgress] = useState('');

    const handlePreview = async () => {
        setLoading(true);
        try {
            const data = await previewConsolidation();
            setPreview(data);
            setResult(null);
        } catch (error) {
            console.error('Preview failed:', error);
        } finally {
            setLoading(false);
        }
    };

    const handleExecute = async () => {
        if (!confirm('¿Estás seguro de que deseas consolidar los logs? Esta acción eliminará los registros duplicados de forma permanente.')) return;

        setLoading(true);
        setResult(null);
        try {
            const data = await executeConsolidation(5, undefined, setProgress);
            setResult(data);
            setPreview(null);
        } catch (error) {
            console.error('Execution failed:', error);
        } finally {
            setLoading(false);
            setProgress('');
        }
    };

    return (
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden mb-6">
            <div className="px-6 py-4 border-b border-slate-100 bg-slate-50/50 flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-amber-100 flex items-center justify-center text-amber-600">
                        <Database size={20} />
                    </div>
                    <div>
                        <h3 className="text-lg font-bold text-slate-800">Mantenimiento de Auditoría</h3>
                        <p className="text-xs text-slate-500">Consolidación de registros duplicados en Firestore</p>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <button
                        onClick={handlePreview}
                        disabled={loading}
                        className="px-4 py-2 text-sm font-bold text-slate-600 hover:bg-slate-100 rounded-xl transition-colors disabled:opacity-50"
                    >
                        {loading && !progress ? <Loader2 size={16} className="animate-spin" /> : 'Previsualizar'}
                    </button>
                    <button
                        onClick={handleExecute}
                        disabled={loading || (!preview && !result)}
                        className="px-4 py-2 text-sm font-bold bg-amber-500 text-white rounded-xl shadow-sm hover:bg-amber-600 transition-colors disabled:opacity-50 flex items-center gap-2"
                    >
                        {loading && progress ? <Loader2 size={16} className="animate-spin" /> : <Trash2 size={16} />}
                        Optimizar Base de Datos
                    </button>
                </div>
            </div>

            <div className="p-6">
                {loading && progress && (
                    <div className="flex flex-col items-center justify-center py-8">
                        <Loader2 className="animate-spin text-amber-500 mb-4" size={32} />
                        <p className="text-sm font-bold text-slate-600">{progress}</p>
                    </div>
                )}

                {!loading && !preview && !result && (
                    <div className="text-center py-8">
                        <div className="w-16 h-16 bg-slate-50 rounded-full flex items-center justify-center mx-auto mb-4">
                            <BarChart3 size={32} className="text-slate-300" />
                        </div>
                        <p className="text-sm text-slate-500 max-w-sm mx-auto">
                            Analiza la base de datos para encontrar registros redundantes generados por ráfagas de edición o errores de sincronización.
                        </p>
                    </div>
                )}

                {preview && (
                    <div className="space-y-4 animate-in fade-in duration-300">
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                            <div className="bg-slate-50 border border-slate-100 p-4 rounded-xl">
                                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Logs Analizados</p>
                                <p className="text-2xl font-black text-slate-700">{preview.totalLogs}</p>
                            </div>
                            <div className="bg-amber-50 border border-amber-100 p-4 rounded-xl">
                                <p className="text-[10px] font-bold text-amber-500 uppercase tracking-widest mb-1">Grupos Duplicados</p>
                                <p className="text-2xl font-black text-amber-700">{preview.duplicateGroups.length}</p>
                            </div>
                            <div className="bg-rose-50 border border-rose-100 p-4 rounded-xl">
                                <p className="text-[10px] font-bold text-rose-500 uppercase tracking-widest mb-1">Registros a Eliminar</p>
                                <p className="text-2xl font-black text-rose-700">{preview.estimatedDeletions}</p>
                            </div>
                        </div>

                        {preview.duplicateGroups.length > 0 && (
                            <div className="border border-slate-100 rounded-xl overflow-hidden">
                                <table className="w-full text-xs">
                                    <thead className="bg-slate-50 text-slate-500 font-bold">
                                        <tr>
                                            <th className="px-4 py-2 text-left">Acción</th>
                                            <th className="px-4 py-2 text-left">Entidad</th>
                                            <th className="px-4 py-2 text-center">Registros</th>
                                            <th className="px-4 py-2 text-right">Rango de Tiempo</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-50">
                                        {preview.duplicateGroups.slice(0, 10).map((g, i) => (
                                            <tr key={i}>
                                                <td className="px-4 py-2 font-bold text-slate-700">{g.action}</td>
                                                <td className="px-4 py-2 text-slate-500 font-mono">{g.entityId}</td>
                                                <td className="px-4 py-2 text-center">
                                                    <span className="bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full font-bold">
                                                        {g.count}
                                                    </span>
                                                </td>
                                                <td className="px-4 py-2 text-right text-slate-400">
                                                    {Math.round((new Date(g.lastTimestamp).getTime() - new Date(g.firstTimestamp).getTime()) / 1000)} segs
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                                {preview.duplicateGroups.length > 10 && (
                                    <div className="p-2 bg-slate-50 text-[10px] text-center text-slate-400 italic">
                                        Mostrando los primeros 10 grupos de {preview.duplicateGroups.length} encontrados...
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                )}

                {result && (
                    <div className="bg-emerald-50 border border-emerald-100 p-6 rounded-2xl animate-in zoom-in duration-300 text-center">
                        <CheckCircle2 className="text-emerald-500 mx-auto mb-3" size={48} />
                        <h4 className="text-lg font-bold text-emerald-800 mb-2">¡Consolidación Exitosa!</h4>
                        <div className="flex justify-center gap-8 mt-4">
                            <div>
                                <p className="text-[10px] font-bold text-emerald-600 uppercase tracking-widest">Logs Fusionados</p>
                                <p className="text-2xl font-black text-emerald-700">{result.logsConsolidated}</p>
                            </div>
                            <div className="w-px h-12 bg-emerald-200/50 self-center" />
                            <div>
                                <p className="text-[10px] font-bold text-emerald-600 uppercase tracking-widest">Logs Eliminados</p>
                                <p className="text-2xl font-black text-rose-600">{result.logsDeleted}</p>
                            </div>
                        </div>
                        {result.errors.length > 0 && (
                            <div className="mt-4 p-3 bg-rose-100 text-rose-700 rounded-xl text-xs text-left">
                                <p className="font-bold mb-1 flex items-center gap-2">
                                    <AlertTriangle size={14} /> Hubo algunos errores:
                                </p>
                                <ul className="list-disc pl-4">
                                    {result.errors.map((e, i) => <li key={i}>{e}</li>)}
                                </ul>
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
};
