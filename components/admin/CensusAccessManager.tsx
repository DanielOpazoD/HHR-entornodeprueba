import React, { useState, useEffect } from 'react';
import {
    UserPlus,
    Trash2,
    Mail,
    Shield,
    Download,
    Eye,
    Search,
    Loader2,
    AlertCircle,
    CheckCircle2,
    X,
    UserCheck
} from 'lucide-react';
import {
    getAuthorizedEmails,
    addAuthorizedEmail,
    removeAuthorizedEmail
} from '../../services/census/censusAccessService';
import { CensusAuthorizedEmail, CensusAccessRole } from '../../types/censusAccess';
import { useAuth } from '../../context/AuthContext';
import clsx from 'clsx';

export const CensusAccessManager: React.FC = () => {
    const { user } = useAuth();
    const [authorizedEmails, setAuthorizedEmails] = useState<CensusAuthorizedEmail[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [successMessage, setSuccessMessage] = useState<string | null>(null);

    // Form state
    const [newEmail, setNewEmail] = useState('');
    const [newRole, setNewRole] = useState<CensusAccessRole>('viewer');
    const [searchTerm, setSearchTerm] = useState('');

    useEffect(() => {
        loadEmails();
    }, []);

    const loadEmails = async () => {
        setIsLoading(true);
        try {
            const emails = await getAuthorizedEmails();
            setAuthorizedEmails(emails.sort((a, b) => a.email.localeCompare(b.email)));
        } catch (err) {
            setError('Error al cargar la lista de correos.');
        } finally {
            setIsLoading(false);
        }
    };

    const handleAddEmail = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!newEmail || !user?.uid) return;

        setIsSubmitting(true);
        setError(null);
        try {
            await addAuthorizedEmail(newEmail, newRole, user.uid);
            setNewEmail('');
            setSuccessMessage(`Correo ${newEmail} autorizado exitosamente.`);
            setTimeout(() => setSuccessMessage(null), 3000);
            await loadEmails();
        } catch (err: any) {
            setError(err.message || 'Error al autorizar correo.');
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleRemoveEmail = async (email: string) => {
        if (!confirm(`¿Estás seguro de quitar el acceso a ${email}?`)) return;

        try {
            await removeAuthorizedEmail(email);
            setAuthorizedEmails(prev => prev.filter(e => e.email !== email));
        } catch (err) {
            setError('Error al eliminar el correo.');
        }
    };

    const filteredEmails = authorizedEmails.filter(e =>
        e.email.toLowerCase().includes(searchTerm.toLowerCase())
    );

    return (
        <div className="bg-white rounded-3xl shadow-sm border border-slate-100 overflow-hidden">
            <div className="p-6 border-b border-slate-50 bg-slate-50/50">
                <div className="flex items-center gap-3 mb-1">
                    <div className="w-10 h-10 rounded-xl bg-medical-100 flex items-center justify-center text-medical-600">
                        <UserCheck size={20} />
                    </div>
                    <div>
                        <h2 className="text-xl font-bold text-slate-800">Acceso Autorizado al Censo</h2>
                        <p className="text-xs text-slate-500 font-medium uppercase tracking-wider">Gestión de Lista Blanca (Gmail)</p>
                    </div>
                </div>
            </div>

            <div className="p-6">
                {/* Add Form */}
                <form onSubmit={handleAddEmail} className="mb-8 p-4 bg-slate-50 rounded-2xl border border-slate-100">
                    <h3 className="text-sm font-bold text-slate-700 mb-4 flex items-center gap-2">
                        <UserPlus size={16} className="text-medical-600" />
                        Autorizar Nuevo Correo
                    </h3>
                    <div className="flex flex-col md:flex-row gap-3">
                        <div className="flex-1 relative">
                            <Mail className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                            <input
                                type="email"
                                placeholder="ejemplo@hospitalhangaroa.cl"
                                className="w-full pl-10 pr-4 py-2.5 bg-white border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-medical-500/20 focus:border-medical-500 transition-all text-sm"
                                value={newEmail}
                                onChange={(e) => setNewEmail(e.target.value)}
                                required
                            />
                        </div>
                        <div className="flex gap-2">
                            <select
                                className="px-4 py-2.5 bg-white border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-medical-500/20 focus:border-medical-500 transition-all text-sm"
                                value={newRole}
                                onChange={(e) => setNewRole(e.target.value as CensusAccessRole)}
                            >
                                <option value="viewer">Visor</option>
                                <option value="downloader">Descargador</option>
                            </select>
                            <button
                                type="submit"
                                disabled={isSubmitting || !newEmail}
                                className="bg-medical-600 hover:bg-medical-700 disabled:bg-slate-300 text-white font-bold px-6 py-2.5 rounded-xl transition-all flex items-center gap-2 whitespace-nowrap active:scale-95"
                            >
                                {isSubmitting ? <Loader2 size={18} className="animate-spin" /> : <CheckCircle2 size={18} />}
                                Autorizar
                            </button>
                        </div>
                    </div>
                </form>

                {/* Messages */}
                {error && (
                    <div className="mb-4 p-3 bg-red-50 border border-red-100 rounded-xl text-red-700 text-sm flex items-center gap-2">
                        <AlertCircle size={18} />
                        {error}
                        <button onClick={() => setError(null)} className="ml-auto"><X size={16} /></button>
                    </div>
                )}
                {successMessage && (
                    <div className="mb-4 p-3 bg-green-50 border border-green-100 rounded-xl text-green-700 text-sm flex items-center gap-2">
                        <CheckCircle2 size={18} />
                        {successMessage}
                    </div>
                )}

                {/* List Header */}
                <div className="flex items-center justify-between mb-4 gap-4">
                    <h3 className="text-sm font-bold text-slate-700">
                        Usuarios Autorizados ({authorizedEmails.length})
                    </h3>
                    <div className="relative flex-1 max-w-xs">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                        <input
                            type="text"
                            placeholder="Buscar correo..."
                            className="w-full pl-9 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:bg-white transition-all text-xs"
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                        />
                    </div>
                </div>

                {/* Table/List */}
                {isLoading ? (
                    <div className="flex flex-col items-center justify-center py-12">
                        <Loader2 className="w-8 h-8 text-medical-600 animate-spin mb-2" />
                        <span className="text-xs text-slate-400 font-medium">Cargando lista...</span>
                    </div>
                ) : filteredEmails.length === 0 ? (
                    <div className="text-center py-12 border-2 border-dashed border-slate-100 rounded-2xl font-medium text-slate-400 text-sm">
                        No hay correos autorizados que coincidan con la búsqueda.
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-left">
                            <thead>
                                <tr className="text-[10px] font-bold text-slate-400 uppercase tracking-widest border-b border-slate-100">
                                    <th className="pb-3 pl-2">Correo Electrónico</th>
                                    <th className="pb-3 text-center">Poder / Rol</th>
                                    <th className="pb-3 text-right pr-2">Acciones</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-50">
                                {filteredEmails.map((item) => (
                                    <tr key={item.email} className="group hover:bg-slate-50/50 transition-colors">
                                        <td className="py-4 pl-2">
                                            <div className="flex items-center gap-2">
                                                <div className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center text-slate-400 group-hover:bg-medical-50 group-hover:text-medical-600 transition-colors">
                                                    <Mail size={14} />
                                                </div>
                                                <span className="text-sm font-semibold text-slate-700">{item.email}</span>
                                            </div>
                                        </td>
                                        <td className="py-4 text-center">
                                            <span className={clsx(
                                                "px-2.5 py-1 rounded-full text-[10px] font-bold uppercase flex items-center gap-1.5 w-fit mx-auto",
                                                item.role === 'downloader'
                                                    ? "bg-teal-50 text-teal-600 border border-teal-100"
                                                    : "bg-blue-50 text-blue-600 border border-blue-100"
                                            )}>
                                                {item.role === 'downloader' ? <Download size={12} /> : <Eye size={12} />}
                                                {item.role === 'downloader' ? 'Descargador' : 'Visor'}
                                            </span>
                                        </td>
                                        <td className="py-4 text-right pr-2">
                                            <button
                                                onClick={() => handleRemoveEmail(item.email)}
                                                className="w-8 h-8 rounded-lg text-slate-300 hover:bg-red-50 hover:text-red-600 transition-all flex items-center justify-center ml-auto"
                                                title="Quitar acceso"
                                            >
                                                <Trash2 size={16} />
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            <div className="p-4 bg-amber-50 border-t border-amber-100">
                <p className="text-[10px] text-amber-700 flex items-start gap-2 leading-relaxed">
                    <Shield size={14} className="flex-shrink-0 mt-0.5" />
                    <strong>Nota de Seguridad:</strong> Los usuarios en esta lista podrán ver el censo del mes actual y anterior simplemente ingresando con su cuenta de Google. Asegúrate de que los correos sean correctos antes de autorizar.
                </p>
            </div>
        </div>
    );
};
