import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Edit2, Trash2, UserPlus, X, ShieldAlert, CheckCircle2, AlertCircle, Search } from 'lucide-react';
import { roleService, UserRoleMap } from '../../services/admin/roleService';
import { useAuth } from '../../context/AuthContext';
import { BaseModal } from '../../components/shared/BaseModal';

const RoleManagementView: React.FC = () => {
    // We get the role from auth, but we treat 'undefined' as 'checking' 
    // and we DON'T unmount the component once it has been matched once.
    const { role: authRole } = useAuth();
    const [lastKnownRole, setLastKnownRole] = useState<string | undefined>(undefined);

    const [roles, setRoles] = useState<UserRoleMap>({});
    const [loading, setLoading] = useState(true);

    // Form state
    const [email, setEmail] = useState('');
    const [selectedRole, setSelectedRole] = useState('viewer');
    const [editingEmail, setEditingEmail] = useState<string | null>(null);

    // UI Feedback state
    const [processing, setProcessing] = useState(false);
    const [message, setMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null);

    // Modal state
    const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

    // Persist role even if provider flickers
    useEffect(() => {
        if (authRole !== undefined) {
            setLastKnownRole(authRole);
        }
    }, [authRole]);

    // Validation
    const isValidEmail = useMemo(() => {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        return emailRegex.test(email);
    }, [email]);

    useEffect(() => {
        loadRoles();
    }, []);

    // Auto-hide success messages
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
            console.error('Error loading roles:', error);
            setMessage({ type: 'error', text: 'Error de conexión con la base de datos.' });
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
            await roleService.setRole(email, selectedRole);

            // Try to sync role (optional)
            try {
                const isDevWithoutEmulator = import.meta.env.DEV && !import.meta.env.VITE_FUNCTIONS_EMULATOR_HOST;
                if (!isDevWithoutEmulator) {
                    await roleService.forceSyncUser(email, selectedRole);
                }
            } catch (e) {
                console.warn('Sync failed, but Firestore saved:', e);
            }

            setMessage({
                type: 'success',
                text: editingEmail ? 'Cambios guardados con éxito.' : `Usuario ${email} registrado.`
            });

            resetForm();
            await loadRoles();
        } catch (error) {
            console.error('Error saving role:', error);
            setMessage({ type: 'error', text: 'No se pudo guardar. Intente nuevamente.' });
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
            await roleService.removeRole(deleteConfirm);
            setMessage({ type: 'success', text: `Usuario eliminado: ${deleteConfirm}` });
            setDeleteConfirm(null);
            await loadRoles();
        } catch (error) {
            console.error('Error removing role:', error);
            setMessage({ type: 'error', text: 'Error al procesar la eliminación.' });
        } finally {
            setProcessing(false);
        }
    };

    // If we've NEVER known the role, show loader
    if (lastKnownRole === undefined) {
        return (
            <div className="flex flex-col items-center justify-center p-20 text-slate-400">
                <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-indigo-600 mb-4 opacity-70"></div>
                <p className="text-sm font-bold tracking-widest uppercase">Autenticando...</p>
            </div>
        );
    }

    // If we know the role and it's not admin, show Access Denied
    if (lastKnownRole !== 'admin') {
        return (
            <div className="flex flex-col items-center justify-center p-20 text-slate-500">
                <ShieldAlert size={64} className="text-rose-400 mb-6" />
                <h2 className="text-2xl font-bold text-slate-800">Acceso No Autorizado</h2>
                <p className="mt-2">Esta sección está restringida únicamente al perfil de Administrador.</p>
            </div>
        );
    }

    // If we are here, we are admin and ready (even if auth flickers briefly, we stay mounted)
    return (
        <div className="max-w-6xl mx-auto p-4 md:p-10 animate-in fade-in duration-700">
            <header className="mb-10 flex flex-col md:flex-row md:items-end md:justify-between gap-6">
                <div>
                    <div className="flex items-center gap-4 mb-3">
                        <div className="bg-indigo-600 p-2.5 rounded-2xl text-white shadow-xl shadow-indigo-100 ring-4 ring-indigo-50">
                            <CheckCircle2 size={24} />
                        </div>
                        <h1 className="text-3xl font-display font-black text-slate-900 tracking-tight">
                            Control de Usuarios
                        </h1>
                    </div>
                    <p className="text-slate-500 max-w-xl font-medium leading-relaxed">
                        Gestiona el acceso dinámico del equipo. Los cambios se actualizan en el servidor y afectan los permisos de visualización y edición en todo el sistema.
                    </p>
                </div>
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
                                {editingEmail ? 'Editar Usuario' : 'Nuevo Registro'}
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
                                    Correo Electrónico
                                </label>
                                <input
                                    type="email"
                                    required
                                    readOnly={!!editingEmail}
                                    value={email}
                                    onChange={(e) => setEmail(e.target.value.toLowerCase().trim())}
                                    placeholder="ejemplo@hospital.cl"
                                    autoFocus
                                    className={`w-full p-4 border-2 rounded-2xl focus:ring-4 focus:ring-indigo-50/50 outline-none transition-all font-bold text-slate-700 placeholder:text-slate-300 ${editingEmail ? 'bg-slate-50 text-slate-400 border-slate-100' : 'border-slate-100 focus:border-indigo-500 bg-white'
                                        }`}
                                />
                                {email && !isValidEmail && (
                                    <p className="text-[11px] text-rose-500 mt-2 px-1 font-bold flex items-center gap-1.5 animate-pulse">
                                        <AlertCircle size={14} /> Correo incompleto
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
                                        <option value="viewer">Invitado (Solo Lectura)</option>
                                        <option value="nurse_hospital">Enfermería Hospitalaria</option>
                                        <option value="doctor_urgency">Médico de Urgencia</option>
                                        <option value="admin">Administrador Total</option>
                                    </select>
                                    <div className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400">
                                        <ShieldAlert size={20} />
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
                                            : 'bg-slate-800 hover:bg-slate-900 shadow-slate-200'
                                    }`}
                            >
                                {processing ? (
                                    <div className="h-5 w-5 border-2 border-white/20 border-t-white rounded-full animate-spin"></div>
                                ) : (
                                    <>
                                        {editingEmail ? <CheckCircle2 size={20} /> : <UserPlus size={20} />}
                                        {editingEmail ? 'Actualizar Datos' : 'Registrar Acceso'}
                                    </>
                                )}
                            </button>
                        </form>
                    </div>

                    <div className="bg-amber-50/50 p-6 rounded-3xl border-2 border-amber-100/50 shadow-inner">
                        <div className="flex gap-4">
                            <ShieldAlert size={24} className="text-amber-400 shrink-0 mt-1" />
                            <p className="text-[12px] text-amber-700 leading-relaxed font-bold italic">
                                ¡AVISO! Los cambios en los roles de administrador pueden afectar el acceso a configuraciones críticas del sistema. Verifique siempre el correo antes de guardar.
                            </p>
                        </div>
                    </div>
                </div>

                {/* TABLE COLUMN */}
                <div className="xl:col-span-8">
                    <div className="bg-white rounded-[2rem] shadow-xl border border-slate-100 overflow-hidden flex flex-col h-full">
                        <div className="px-8 py-6 bg-slate-50/50 border-b border-slate-100 flex items-center justify-between">
                            <h2 className="text-xl font-black text-slate-800 flex items-center gap-3">
                                <Search size={20} className="text-slate-400" />
                                Usuarios Autorizados
                            </h2>
                            <div className="bg-white px-4 py-1.5 border-2 border-slate-100 rounded-full text-[10px] font-black text-indigo-600 uppercase shadow-sm">
                                {Object.keys(roles).length} Cuentas
                            </div>
                        </div>

                        {loading ? (
                            <div className="flex-1 flex flex-col items-center justify-center p-20">
                                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600 mb-6 opacity-30"></div>
                                <span className="text-slate-300 font-bold uppercase tracking-[0.3em] text-[10px]">Cargando Listado...</span>
                            </div>
                        ) : Object.keys(roles).length === 0 ? (
                            <div className="flex-1 flex flex-col items-center justify-center p-20 text-center">
                                <div className="bg-slate-50 w-24 h-24 rounded-full flex items-center justify-center mx-auto mb-6 border-4 border-dashed border-slate-100">
                                    <UserPlus className="text-slate-200" size={48} />
                                </div>
                                <h3 className="text-2xl font-black text-slate-800">Directorio Vacío</h3>
                                <p className="text-slate-400 max-w-sm mx-auto mt-3 font-medium text-sm">
                                    No hay configuraciones dinámicas registradas. Usa el formulario para agregar el primer acceso institucional.
                                </p>
                            </div>
                        ) : (
                            <div className="overflow-x-auto">
                                <table className="w-full text-left">
                                    <thead>
                                        <tr className="bg-slate-50/10">
                                            <th className="px-8 py-5 text-[11px] font-black text-slate-400 uppercase tracking-widest border-b border-slate-50">Correo</th>
                                            <th className="px-8 py-5 text-[11px] font-black text-slate-400 uppercase tracking-widest border-b border-slate-50">Permisos</th>
                                            <th className="px-8 py-5 text-[11px] font-black text-slate-400 uppercase tracking-widest text-right border-b border-slate-50">Acciones</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-50">
                                        {Object.entries(roles).map(([userEmail, role]) => (
                                            <tr key={userEmail} className={`transition-all duration-300 ${editingEmail === userEmail ? 'bg-indigo-50/50' : 'hover:bg-slate-50/30'}`}>
                                                <td className="px-8 py-6">
                                                    <div className="font-black text-slate-700 text-sm tracking-tight" title={userEmail}>
                                                        {userEmail}
                                                    </div>
                                                </td>
                                                <td className="px-8 py-6">
                                                    <div className={`px-4 py-1.5 rounded-2xl text-[10px] font-black inline-flex items-center gap-2 tracking-tighter shadow-sm border ${role === 'admin' ? 'bg-indigo-600 text-white border-indigo-700' :
                                                            role === 'nurse_hospital' ? 'bg-emerald-500 text-white border-emerald-600' :
                                                                role === 'doctor_urgency' ? 'bg-sky-500 text-white border-sky-600' :
                                                                    'bg-slate-400 text-white border-slate-500'
                                                        }`}>
                                                        {role === 'nurse_hospital' ? 'ENFERMERÍA HOSPITAL' :
                                                            role === 'doctor_urgency' ? 'MÉDICO URGENCIA' :
                                                                role === 'admin' ? 'ADMIN TOTAL' :
                                                                    'INVITADO'}
                                                    </div>
                                                </td>
                                                <td className="px-8 py-6">
                                                    <div className="flex items-center justify-end gap-3">
                                                        <button
                                                            onClick={() => handleEdit(userEmail, role)}
                                                            className="flex items-center gap-2 px-3 py-2 text-indigo-600 hover:bg-indigo-600 hover:text-white rounded-xl transition-all font-bold text-xs ring-2 ring-indigo-50 hover:ring-indigo-600 shadow-sm"
                                                        >
                                                            <Edit2 size={14} /> <span className="hidden md:inline">Editar</span>
                                                        </button>
                                                        <button
                                                            onClick={() => handleDeleteClick(userEmail)}
                                                            className="flex items-center gap-2 px-3 py-2 text-rose-500 hover:bg-rose-500 hover:text-white rounded-xl transition-all font-bold text-xs ring-2 ring-rose-50 hover:ring-rose-500 shadow-sm"
                                                        >
                                                            <Trash2 size={14} /> <span className="hidden md:inline">Quitar</span>
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
                title="Protocolo de Seguridad"
                icon={<Trash2 size={24} />}
                headerIconColor="text-rose-500"
                size="md"
            >
                <div className="p-2 space-y-6">
                    <div className="bg-rose-50 p-6 rounded-[2rem] flex flex-col items-center text-center gap-4 border-2 border-rose-100 shadow-inner">
                        <div className="bg-white p-4 rounded-full shadow-lg shadow-rose-100 animate-bounce">
                            <ShieldAlert className="text-rose-500" size={32} />
                        </div>
                        <div>
                            <p className="text-[10px] font-black text-rose-400 uppercase tracking-widest mb-1">Confirmar Revocación</p>
                            <h3 className="text-lg font-black text-rose-700 leading-tight">
                                ¿Deseas eliminar a <span className="block underline decoration-rose-300">{deleteConfirm}</span> de la base de datos?
                            </h3>
                        </div>
                    </div>

                    <p className="text-slate-500 text-xs font-bold leading-relaxed px-4 text-center italic">
                        "Esta acción es irreversible y el usuario perderá acceso inmediato a los módulos restringidos si no posee otra cuenta válida."
                    </p>

                    <div className="grid grid-cols-2 gap-4">
                        <button
                            onClick={() => setDeleteConfirm(null)}
                            disabled={processing}
                            className="p-4 bg-slate-100 hover:bg-slate-200 text-slate-500 font-black uppercase tracking-widest text-[11px] rounded-2xl transition-all active:scale-95"
                        >
                            Ignorar
                        </button>
                        <button
                            onClick={confirmDelete}
                            disabled={processing}
                            className="p-4 bg-rose-600 hover:bg-rose-700 text-white font-black uppercase tracking-widest text-[11px] rounded-2xl transition-all shadow-xl shadow-rose-100 active:scale-95 flex items-center justify-center gap-2"
                        >
                            {processing ? (
                                <div className="h-4 w-4 border-2 border-white/20 border-t-white rounded-full animate-spin"></div>
                            ) : (
                                'Confirmar'
                            )}
                        </button>
                    </div>
                </div>
            </BaseModal>
        </div>
    );
};

export default RoleManagementView;
