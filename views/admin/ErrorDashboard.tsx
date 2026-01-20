import React, { useState, useEffect } from 'react';
import { getErrorLogs, clearErrorLogs } from '@/services/storage/indexedDBService';
import { ErrorLog } from '@/services/utils/errorService';
import {
    AlertTriangle,
    Trash2,
    RefreshCw,
    ChevronDown,
    ChevronUp,
    Clock,
    User,
    Database
} from 'lucide-react';
import clsx from 'clsx';

export const ErrorDashboard: React.FC = () => {
    const [logs, setLogs] = useState<ErrorLog[]>([]);
    const [loading, setLoading] = useState(true);
    const [expandedId, setExpandedId] = useState<string | null>(null);

    const loadLogs = async () => {
        setLoading(true);
        try {
            const data = await getErrorLogs();
            setLogs(data.reverse()); // Newest first
        } catch (error) {
            console.error('Failed to load logs:', error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadLogs();
    }, []);

    const handleClear = async () => {
        if (window.confirm('¿Seguro que desea limpiar todos los registros de errores?')) {
            await clearErrorLogs();
            await loadLogs();
        }
    };

    const toggleExpand = (id: string) => {
        setExpandedId(expandedId === id ? null : id);
    };

    return (
        <div className="max-w-6xl mx-auto space-y-4">
            <div className="flex justify-end items-center gap-2 mb-2">
                <button
                    onClick={loadLogs}
                    className="btn-secondary py-1.5 px-3 text-xs flex items-center gap-2"
                    disabled={loading}
                >
                    <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
                    Actualizar
                </button>
                <button
                    onClick={handleClear}
                    className="bg-red-50 text-red-600 border border-red-100 hover:bg-red-100 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors flex items-center gap-2"
                    disabled={logs.length === 0}
                >
                    <Trash2 size={14} />
                    Limpiar Registro
                </button>
            </div>

            {loading ? (
                <div className="flex justify-center py-20">
                    <RefreshCw size={40} className="animate-spin text-medical-400" />
                </div>
            ) : logs.length === 0 ? (
                <div className="card p-20 flex flex-col items-center justify-center text-slate-400">
                    <AlertTriangle size={48} className="mb-4 opacity-20" />
                    <p className="text-lg">No se han registrado errores locales.</p>
                    <p className="text-xs mt-2 uppercase tracking-widest font-bold">Base de datos limpia</p>
                </div>
            ) : (
                <div className="space-y-4">
                    {logs.map((log) => (
                        <div
                            key={log.id}
                            className={clsx(
                                "card transition-all overflow-hidden border-l-4",
                                log.severity === 'high' ? "border-l-red-500" : "border-l-orange-400",
                                expandedId === log.id ? "ring-2 ring-medical-500/10 shadow-md" : "hover:bg-slate-50/50"
                            )}
                        >
                            <div
                                className="p-4 cursor-pointer flex items-center justify-between"
                                onClick={() => toggleExpand(log.id)}
                            >
                                <div className="flex items-center gap-4">
                                    <div className={clsx(
                                        "p-2 rounded-lg",
                                        log.severity === 'high' ? "bg-red-50 text-red-600" : "bg-orange-50 text-orange-600"
                                    )}>
                                        <AlertTriangle size={20} />
                                    </div>
                                    <div>
                                        <h3 className="font-bold text-slate-800">{log.message}</h3>
                                        <div className="flex gap-4 mt-1">
                                            <span className="flex items-center gap-1 text-[11px] text-slate-500">
                                                <Clock size={12} /> {new Date(log.timestamp).toLocaleString()}
                                            </span>
                                            {log.url && (
                                                <span className="flex items-center gap-1 text-[11px] text-slate-500 max-w-[200px] truncate">
                                                    <Database size={12} /> {new URL(log.url).pathname}
                                                </span>
                                            )}
                                            {log.userId && (
                                                <span className="flex items-center gap-1 text-[11px] text-slate-500">
                                                    <User size={12} /> {log.userId}
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                </div>
                                <div className="text-slate-400">
                                    {expandedId === log.id ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
                                </div>
                            </div>

                            {expandedId === log.id && (
                                <div className="p-4 bg-slate-50 border-t border-slate-100 animate-fade-in">
                                    <h4 className="text-[10px] font-bold text-slate-400 uppercase mb-2">Stack Trace / Context</h4>
                                    <pre className="text-xs font-mono bg-slate-900 text-slate-200 p-4 rounded-lg overflow-x-auto whitespace-pre-wrap max-h-60 overflow-y-auto">
                                        {log.stack || 'No stack trace available'}
                                        {log.context && (
                                            <>
                                                {"\n\n--- Context ---\n"}
                                                {JSON.stringify(log.context, null, 2)}
                                            </>
                                        )}
                                    </pre>
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};
