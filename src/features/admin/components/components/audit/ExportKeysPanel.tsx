import React, { useState, useEffect } from 'react';
import { Key, RefreshCw, Calendar, CheckCircle2 } from 'lucide-react';
import clsx from 'clsx';

export const ExportKeysPanel: React.FC = () => {
    const [passwords, setPasswords] = useState<Array<{ date: string; password: string; source?: string; createdAt?: string }>>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const loadPasswords = async () => {
            setLoading(true);
            try {
                // Fetch stored passwords from Firestore
                const { getStoredPasswords } = await import('@/services/security/exportPasswordService');
                const storedPasswords = await getStoredPasswords(60); // Last 60 passwords

                setPasswords(storedPasswords.map(p => ({
                    date: p.date,
                    password: p.password,
                    source: p.source,
                    createdAt: p.createdAt
                })));
            } catch (error) {
                console.error('Failed to load passwords:', error);
            } finally {
                setLoading(false);
            }
        };

        loadPasswords();
    }, []);

    const formatDateDisplay = (dateStr: string): string => {
        const [year, month, day] = dateStr.split('-');
        const monthNames = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
        return `${day} ${monthNames[parseInt(month, 10) - 1]} ${year} `;
    };

    const copyToClipboard = (password: string) => {
        navigator.clipboard.writeText(password);
    };

    if (loading) {
        return (
            <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-12 text-center">
                <RefreshCw size={32} className="animate-spin text-rose-500 mx-auto mb-4" />
                <p className="text-slate-400">Cargando claves de exportación...</p>
            </div>
        );
    }

    return (
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
            <div className="p-6 border-b border-slate-100 bg-gradient-to-r from-rose-50 to-pink-50">
                <div className="flex items-center gap-4">
                    <div className="w-12 h-12 rounded-xl bg-rose-600 flex items-center justify-center shadow-lg shadow-rose-200">
                        <Key className="text-white" size={24} />
                    </div>
                    <div>
                        <h3 className="text-lg font-bold text-slate-900">Claves de Exportación Excel</h3>
                        <p className="text-sm text-slate-500">
                            Registro permanente de contraseñas usadas en archivos exportados. Guardadas automáticamente en Firestore.
                        </p>
                    </div>
                </div>
            </div>

            <div className="p-4">
                {passwords.length === 0 ? (
                    <div className="text-center py-12">
                        <Key size={48} className="mx-auto text-slate-200 mb-4" />
                        <p className="text-slate-500 font-medium">No hay claves registradas aún</p>
                        <p className="text-slate-400 text-sm mt-1">Las claves se guardan automáticamente al enviar correos o descargar archivos Excel.</p>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                        {passwords.map(({ date, password, source }) => (
                            <div
                                key={date}
                                className="flex items-center justify-between p-4 bg-slate-50 rounded-xl border border-slate-100 hover:border-rose-200 hover:bg-rose-50/30 transition-all group"
                            >
                                <div className="flex flex-col gap-1">
                                    <div className="flex items-center gap-2">
                                        <Calendar size={14} className="text-slate-400" />
                                        <span className="font-medium text-slate-700">{formatDateDisplay(date)}</span>
                                    </div>
                                    {source && (
                                        <span className={clsx(
                                            "text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded w-fit",
                                            source === 'email' ? "bg-indigo-100 text-indigo-600" : "bg-emerald-100 text-emerald-600"
                                        )}>
                                            {source === 'email' ? '📧 Correo' : '📥 Descarga'}
                                        </span>
                                    )}
                                </div>
                                <button
                                    onClick={() => copyToClipboard(password)}
                                    className="flex items-center gap-2 px-3 py-1.5 bg-white rounded-lg border border-slate-200 hover:border-rose-300 hover:bg-rose-50 transition-all font-mono text-sm font-bold text-rose-600 group-hover:shadow-sm"
                                    title="Clic para copiar"
                                >
                                    {password}
                                </button>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            <div className="p-4 border-t border-slate-100 bg-emerald-50/50">
                <div className="flex items-center gap-2 text-emerald-700 text-xs font-medium">
                    <CheckCircle2 size={14} />
                    <span>Las claves se guardan permanentemente en Firestore. Si necesita una clave antigua, siempre estará disponible aquí.</span>
                </div>
            </div>
        </div>
    );
};
