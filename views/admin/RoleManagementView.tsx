import React, { useState, useEffect, useMemo } from 'react';
import { Edit2, Trash2, UserPlus, X, ShieldAlert, CheckCircle2, AlertCircle, Search, RefreshCw } from 'lucide-react';
import { roleService, UserRoleMap } from '../../services/admin/roleService';
import { useAuth } from '../../context/AuthContext';
import { BaseModal } from '../../components/shared/BaseModal';

const RoleManagementView: React.FC = () => {
    const { role: authRole } = useAuth();
    const [roles, setRoles] = useState<UserRoleMap>({});
    const [loading, setLoading] = useState(true);

    // Form state - persistent as long as AppRouter stays mounted
    const [email, setEmail] = useState('');
    const [selectedRole, setSelectedRole] = useState('viewer');
    const [editingEmail, setEditingEmail] = useState<string | null>(null);

    // UI Feedback
    const [processing, setProcessing] = useState(false);
    const [message, setMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null);

    // Modal state
    const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

    // Strict Email Validation
    const isValidEmail = useMemo(() => {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        return emailRegex.test(email);
    }, [email]);

    useEffect(() => {
        console.log('[RoleManagement] Component Mounted - Focus Protection Active');
        loadRoles();
    }, []);

    // Success auto-hide
    useEffect(() => {
        if (message?.type === 'success') {
            const timer = setTimeout(() => setMessage(null), 5000);
            return () => clearTimeout(timer);
        }
    }, [message]);

    const loadRoles = async () => {
        try {
            setLoading(true);
            const data = await roleService.getRoles();
            setRoles(data);
        } catch (error) {
            console.error('[RoleManagement] Load error:', error);
            setMessage({ type: 'error', text: 'Error de conexión con Firestore.' });
        } finally {
            setLoading(false);
        }
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!isValidEmail || processing) return;

        setProcessing(true);
        setMessage(null);

        try {
            // 🔥 FIX: If email was changed during edit, remove the old key (rename flow)
            if (editingEmail && email !== editingEmail) {
                console.log(`[RoleManagement] Renaming user: Removing old entry ${editingEmail}`);
                await roleService.removeRole(editingEmail);
            }

            console.log(`[RoleManagement] Writing to config/roles: ${email} = ${selectedRole}`);
            await roleService.setRole(email, selectedRole);

            setMessage({
                type: 'success',
                text: editingEmail
                    ? (email !== editingEmail ? 'Usuario renombrado y actualizado.' : 'Rol actualizado correctamente.')
                    : `Acceso otorgado a ${email}.`
            });

            resetForm();
            await loadRoles();
        } catch (error) {
            console.error('[RoleManagement] Save error:', error);
            setMessage({ type: 'error', text: 'Error al guardar cambios. Verifica tu conexión.' });
        } finally {
            setProcessing(false);
        }
    };

    const handleEdit = (targetEmail: string, currentRole: string) => {
        setEmail(targetEmail);
        setSelectedRole(currentRole);
        setEditingEmail(targetEmail);
        setMessage(null);
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    const resetForm = () => {
        setEmail('');
        setSelectedRole('viewer');
        setEditingEmail(null);
        setMessage(null);
    };

    const handleDeleteClick = (targetEmail: string) => {
        setDeleteConfirm(targetEmail);
    };

    const confirmDelete = async () => {
        if (!deleteConfirm) return;

        setProcessing(true);
        try {
            console.log(`[RoleManagement] Removing entry for: ${deleteConfirm}`);
            await roleService.removeRole(deleteConfirm);
            setMessage({ type: 'success', text: `Acceso eliminado para ${deleteConfirm}` });
            setDeleteConfirm(null);
            await loadRoles();
        } catch (error) {
            console.error('[RoleManagement] Delete error:', error);
            setMessage({ type: 'error', text: 'Error al eliminar. Revisa tu perfil de Administrador.' });
        } finally {
            setProcessing(false);
        }
    };

    // If authRole is definitively NOT admin (and not undefined/loading), show blocked
    if (authRole !== 'admin' && authRole !== undefined) {
        return (
            <div className="flex flex-col items-center justify-center p-20 text-slate-500 text-center">
                <ShieldAlert size={64} className="text-rose-400 mb-6" />
                <h2 className="text-2xl font-black text-slate-800">Acceso Restringido</h2>
                <p className="mt-2 max-w-sm">Tu cuenta actual no tiene privilegios de Escritura en el nodo de configuración global.</p>
                <button
                    onClick={() => window.location.reload()}
                    className="mt-8 px-6 py-3 bg-indigo-600 text-white rounded-2xl font-black text-xs uppercase tracking-widest shadow-xl shadow-indigo-100 active:scale-95 transition-all"
                >
                    Forzar Re-Sincronización
                </button>
            </div>
        );
    }

    return (
        <div className="max-w-6xl mx-auto p-4 md:p-10 animate-in fade-in duration-700">
            <header className="mb-10 flex flex-col md:flex-row md:items-end md:justify-between gap-6">
                <div>
                    <div className="flex items-center gap-4 mb-3">
                        <div className="bg-indigo-600 p-2.5 rounded-2xl text-white shadow-xl shadow-indigo-100 ring-4 ring-indigo-50">
                            <CheckCircle2 size={24} />
                        </div>
                        <h1 className="text-3xl font-display font-black text-slate-900 tracking-tight">
                            Gestión de Roles Pro
                        </h1>
                    </div>
                    <p className="text-slate-500 max-w-xl font-medium leading-relaxed">
                        Control central de permisos. Estos cambios se almacenan en `config/roles` y prevalecen sobre el sistema de Claims de Google.
                    </p>
                </div>

                <button
                    onClick={loadRoles}
                    disabled={loading}
                    className="flex items-center gap-2 px-4 py-2 bg-white border-2 border-slate-100 rounded-xl text-slate-400 font-bold text-xs hover:bg-slate-50 transition-all active:scale-95"
                >
                    <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
                    Actualizar Lista
                </button>
            </header>

            {/* Notifications */}
            {message && (
                <div className={`p-5 mb-8 rounded-2xl border-2 flex items-center gap-4 shadow-sm animate-in zoom-in-95 duration-300 ${message.type === 'success'
                    ? 'bg-emerald-50 text-emerald-700 border-emerald-100'
                    : 'bg-rose-50 text-rose-700 border-rose-100'
                    }`}>
                    {message.type === 'success' ? <CheckCircle2 size={24} /> : <AlertCircle size={24} />}
                    <span className="flex-1 font-bold text-sm tracking-tight">{message.text}</span>
                    <button onClick={() => setMessage(null)} className="p-1 hover:bg-black/5 rounded-full transition-transform active:scale-90">
                        <X size={20} />
                    </button>
                </div>
            )}

            <div className="grid grid-cols-1 xl:grid-cols-12 gap-10">
                {/* FORM COLUMN */}
                <div className="xl:col-span-4 space-y-8">
                    <div className={`bg-white p-8 rounded-[2rem] shadow-2xl transition-all duration-500 border-2 ${editingEmail ? 'border-indigo-500 shadow-indigo-100/50' : 'border-slate-100'
                        }`}>
                        <div className="flex items-center justify-between mb-8">
                            <h2 className="text-xl font-black text-slate-800 flex items-center gap-3">
                                {editingEmail ? <Edit2 size={24} className="text-indigo-600" /> : <UserPlus size={24} className="text-indigo-600" />}
                                {editingEmail ? 'Editar Usuario' : 'Nuevo Acceso'}
                            </h2>
                            {editingEmail && (
                                <button
                                    onClick={resetForm}
                                    className="text-slate-300 hover:text-rose-500 transition-all hover:rotate-90 duration-300 p-1"
                                    title="Cancelar edición"
                                >
                                    <X size={24} />
                                </button>
                            )}
                        </div>

                        <form onSubmit={handleSubmit} className="space-y-6">
                            <div>
                                <label className="block text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] mb-2 px-1">
                                    Correo Institucional
                                </label>
                                <input
                                    type="email"
                                    required
                                    value={email}
                                    onChange={(e) => setEmail(e.target.value.toLowerCase().trim())}
                                    placeholder="usuario@dominio.cl"
                                    autoFocus
                                    className={`w-full p-4 border-2 rounded-2xl focus:ring-4 focus:ring-indigo-50/50 outline-none transition-all font-bold text-slate-700 placeholder:text-slate-200 ${editingEmail ? 'border-indigo-400 bg-indigo-50/10' : 'border-slate-100 focus:border-indigo-500 bg-white'
                                        }`}
                                />
                                {email && !isValidEmail && (
                                    <p className="text-[11px] text-rose-500 mt-2 px-1 font-bold flex items-center gap-1.5 animate-pulse">
                                        <AlertCircle size={14} /> Correo incompleto o inválido
                                    </p>
                                )}
                            </div>

                            <div>
                                <label className="block text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] mb-2 px-1">
                                    Nivel de Permisos
                                </label>
                                <div className="relative">
                                    <select
                                        value={selectedRole}
                                        disabled={processing}
                                        onChange={(e) => setSelectedRole(e.target.value)}
                                        className="w-full p-4 border-2 border-slate-100 rounded-2xl focus:ring-4 focus:ring-indigo-50/50 focus:border-indigo-500 outline-none bg-white transition-all cursor-pointer font-bold text-slate-700 appearance-none shadow-sm"
                                    >
                                        <option value="viewer">🎨 Invitado (Solo Lectura)</option>
                                        <option value="nurse_hospital">👩‍⚕️ Enfermería Hospitalaria</option>
                                        <option value="doctor_urgency">🩺 Médico de Urgencia</option>
                                        <option value="admin">🔑 Administrador Total</option>
                                    </select>
                                    <div className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none text-slate-300">
                                        <RefreshCw size={18} />
                                    </div>
                                </div>
                            </div>

                            <button
                                type="submit"
                                disabled={processing || !isValidEmail}
                                className={`w-full p-5 rounded-2xl text-white font-black uppercase tracking-widest text-xs transition-all shadow-xl active:scale-[0.96] flex items-center justify-center gap-3 ${processing || !isValidEmail
                                    ? 'bg-slate-200 text-slate-400 cursor-not-allowed shadow-none'
                                    : editingEmail
                                        ? 'bg-indigo-600 hover:bg-indigo-700 shadow-indigo-200'
                                        : 'bg-slate-900 hover:bg-black shadow-slate-200'
                                    }`}
                            >
                                {processing ? (
                                    <div className="h-5 w-5 border-2 border-white/20 border-t-white rounded-full animate-spin"></div>
                                ) : (
                                    <>
                                        {editingEmail ? <CheckCircle2 size={20} /> : <UserPlus size={20} />}
                                        {editingEmail ? 'Guardar Cambios' : 'Conceder Acceso'}
                                    </>
                                )}
                            </button>
                        </form>
                    </div>

                    <div className="bg-blue-50/50 p-6 rounded-3xl border-2 border-blue-100/50 shadow-inner">
                        <div className="flex gap-4">
                            <ShieldAlert size={28} className="text-blue-500 shrink-0 mt-1" />
                            <div>
                                <p className="text-[12px] text-blue-800 leading-relaxed font-bold mb-3 uppercase tracking-wider">Despliegue Requerido</p>
                                <p className="text-[11px] text-blue-700 leading-relaxed font-semibold italic">
                                    Si al guardar ves errores de permiso, ejecuta el comando de reglas en tu terminal.
                                </p>
                            </div>
                        </div>
                    </div>
                </div>

                {/* TABLE COLUMN */}
                <div className="xl:col-span-8">
                    <div className="bg-white rounded-[2rem] shadow-xl border border-slate-100 overflow-hidden flex flex-col h-full">
                        <div className="px-8 py-6 bg-slate-50/50 border-b border-slate-100 flex items-center justify-between">
                            <h2 className="text-xl font-black text-slate-800 flex items-center gap-3">
                                <Search size={22} className="text-slate-400" />
                                Cuentas Autorizadas
                            </h2>
                            <div className="bg-white px-5 py-2 border-2 border-slate-100 rounded-full text-[10px] font-black text-indigo-600 uppercase shadow-sm tracking-widest">
                                {Object.keys(roles).length} Registros
                            </div>
                        </div>

                        {loading ? (
                            <div className="flex-1 flex flex-col items-center justify-center p-24">
                                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600 mb-6 opacity-30"></div>
                                <span className="text-slate-300 font-bold uppercase tracking-[0.4em] text-[9px]">Sincronizando con Firestore</span>
                            </div>
                        ) : Object.keys(roles).length === 0 ? (
                            <div className="flex-1 flex flex-col items-center justify-center p-24 text-center">
                                <div className="bg-slate-50 w-24 h-24 rounded-full flex items-center justify-center mx-auto mb-6 border-4 border-dashed border-slate-100">
                                    <UserPlus className="text-slate-200" size={48} />
                                </div>
                                <h3 className="text-2xl font-black text-slate-800">No hay configuraciones</h3>
                                <p className="text-slate-400 max-w-sm mx-auto mt-3 font-medium text-sm">
                                    Usa el formulario para agregar accesos por correo institucional.
                                </p>
                            </div>
                        ) : (
                            <div className="overflow-x-auto">
                                <table className="w-full text-left">
                                    <thead>
                                        <tr className="bg-slate-50/10">
                                            <th className="px-8 py-6 text-[11px] font-black text-slate-400 uppercase tracking-[0.2em] border-b border-slate-50">Correo</th>
                                            <th className="px-8 py-6 text-[11px] font-black text-slate-400 uppercase tracking-[0.2em] border-b border-slate-50">Acceso</th>
                                            <th className="px-8 py-6 text-[11px] font-black text-slate-400 uppercase tracking-[0.2em] text-right border-b border-slate-50">Acciones</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-50">
                                        {Object.entries(roles).map(([userEmail, role]) => (
                                            <tr key={userEmail} className={`transition-all duration-300 ${editingEmail === userEmail ? 'bg-indigo-50' : 'hover:bg-slate-50/50'}`}>
                                                <td className="px-8 py-6">
                                                    <div className="font-black text-slate-700 text-sm tracking-tight" title={userEmail}>
                                                        {userEmail}
                                                    </div>
                                                </td>
                                                <td className="px-8 py-6">
                                                    <div className={`px-4 py-1.5 rounded-2xl text-[10px] font-black inline-flex items-center gap-2 border shadow-sm ${role === 'admin' ? 'bg-indigo-600 text-white border-indigo-700' :
                                                        role === 'nurse_hospital' ? 'bg-emerald-500 text-white border-emerald-600' :
                                                            role === 'doctor_urgency' ? 'bg-sky-500 text-white border-sky-600' :
                                                                'bg-slate-400 text-white border-slate-500'
                                                        }`}>
                                                        {role === 'nurse_hospital' ? 'ENFERMERÍA' :
                                                            role === 'doctor_urgency' ? 'URGENCIA' :
                                                                role === 'admin' ? 'ADMIN' :
                                                                    'INVITADO'}
                                                    </div>
                                                </td>
                                                <td className="px-8 py-6">
                                                    <div className="flex items-center justify-end gap-3">
                                                        <button
                                                            onClick={() => handleEdit(userEmail, role)}
                                                            className="flex items-center gap-2 px-4 py-3 bg-white text-indigo-600 border-2 border-slate-100 hover:bg-indigo-600 hover:text-white hover:border-indigo-600 rounded-2xl transition-all font-black text-[10px] uppercase tracking-widest shadow-sm"
                                                        >
                                                            <Edit2 size={14} /> Editar
                                                        </button>
                                                        <button
                                                            onClick={() => handleDeleteClick(userEmail)}
                                                            className="flex items-center gap-2 px-4 py-3 bg-white text-rose-500 border-2 border-slate-100 hover:bg-rose-600 hover:text-white hover:border-rose-600 rounded-2xl transition-all font-black text-[10px] uppercase tracking-widest shadow-sm"
                                                        >
                                                            <Trash2 size={14} /> Quitar
                                                        </button>
                                                    </div>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* Confirmation Modal */}
            <BaseModal
                isOpen={!!deleteConfirm}
                onClose={() => !processing && setDeleteConfirm(null)}
                closeOnBackdrop={false}
                title="Confirmar Acción Crítica"
                icon={<Trash2 size={24} />}
                headerIconColor="text-rose-500"
                size="md"
            >
                <div className="p-2 space-y-6">
                    <div className="bg-rose-50 p-8 rounded-[2.5rem] flex flex-col items-center text-center gap-5 border-2 border-rose-100 shadow-inner">
                        <div className="bg-white p-5 rounded-full shadow-lg shadow-rose-100">
                            <ShieldAlert className="text-rose-500" size={36} />
                        </div>
                        <div>
                            <p className="text-[10px] font-black text-rose-400 uppercase tracking-widest mb-1.5">Revocación de Acceso</p>
                            <h3 className="text-xl font-black text-rose-800 leading-tight">
                                ¿Deseas eliminar a <span className="block underline decoration-rose-200 mt-1">{deleteConfirm}</span>?
                            </h3>
                        </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                        <button
                            onClick={() => setDeleteConfirm(null)}
                            disabled={processing}
                            className="p-5 bg-slate-100 hover:bg-slate-200 text-slate-500 font-black uppercase tracking-widest text-[11px] rounded-2xl transition-all active:scale-95"
                        >
                            Cancelar
                        </button>
                        <button
                            onClick={confirmDelete}
                            disabled={processing}
                            className="p-5 bg-rose-600 hover:bg-rose-700 text-white font-black uppercase tracking-widest text-[11px] rounded-2xl transition-all shadow-xl shadow-rose-100 active:scale-95 flex items-center justify-center gap-2"
                        >
                            {processing ? (
                                <div className="h-5 w-5 border-2 border-white/20 border-t-white rounded-full animate-spin"></div>
                            ) : (
                                'Sí, Borrar'
                            )}
                        </button>
                    </div>
                </div>
            </BaseModal>
        </div>
    );
};

export default RoleManagementView;
