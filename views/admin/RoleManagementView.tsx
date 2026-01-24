import React, { useState, useEffect, useMemo } from 'react';
import { Edit2, Trash2, UserPlus, X, ShieldAlert, CheckCircle2, AlertCircle } from 'lucide-react';
import { roleService, UserRoleMap } from '../../services/admin/roleService';
import { useAuth } from '../../context/AuthContext';
import { BaseModal } from '../../components/shared/BaseModal';

const RoleManagementView: React.FC = () => {
    const { role: userRole } = useAuth();
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

    // Validation: Only allow valid-looking institutional emails or at least a realistic string
    const isValidEmail = useMemo(() => {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        return emailRegex.test(email) && email.length > 5;
    }, [email]);

    useEffect(() => {
        loadRoles();
    }, []);

    // Auto-hide success messages after 5 seconds
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
            setMessage({ type: 'error', text: 'Error al conectar con la base de datos.' });
        } finally {
            setLoading(false);
        }
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        // Block manual "d" style saves
        if (!isValidEmail || processing) return;

        setProcessing(true);
        setMessage(null);

        try {
            // 1. Save to Firestore
            await roleService.setRole(email, selectedRole);

            // 2. Force sync via Cloud Function (Optional/Silent Fail in Dev)
            try {
                // Skip sync in DEV if no emulator host to avoid network errors
                const isDevWithoutEmulator = import.meta.env.DEV && !import.meta.env.VITE_FUNCTIONS_EMULATOR_HOST;

                if (!isDevWithoutEmulator) {
                    await roleService.forceSyncUser(email, selectedRole);
                    setMessage({
                        type: 'success',
                        text: editingEmail
                            ? `Rol actualizado para ${email}.`
                            : `Usuario ${email} configurado.`
                    });
                } else {
                    setMessage({
                        type: 'success',
                        text: editingEmail ? 'Cambios guardados localmente.' : 'Usuario guardado.'
                    });
                }
            } catch (syncError) {
                console.warn('[RoleManagement] Sync trace (non-critical):', syncError);
                setMessage({
                    type: 'success',
                    text: `Datos guardados. Los permisos se aplicarán al siguiente login.`
                });
            }

            resetForm();
            await loadRoles();
        } catch (error) {
            console.error('Error saving role:', error);
            setMessage({ type: 'error', text: 'No se pudo guardar. Revisa tu conexión.' });
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
            setMessage({ type: 'success', text: `Eliminado: ${deleteConfirm}` });
            setDeleteConfirm(null);
            await loadRoles();
        } catch (error) {
            console.error('Error removing role:', error);
            setMessage({ type: 'error', text: 'Error al eliminar. Reintenta.' });
        } finally {
            setProcessing(false);
        }
    };

    // Access check loader to avoid flickering and focus loss
    if (loading && userRole === undefined) {
        return (
            <div className="flex flex-col items-center justify-center p-12 text-slate-500">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600 mb-4"></div>
                <p>Verificando credenciales...</p>
            </div>
        );
    }

    if (userRole !== 'admin') {
        return (
            <div className="flex flex-col items-center justify-center p-12 text-slate-500">
                <ShieldAlert size={48} className="text-red-400 mb-4" />
                <h2 className="text-xl font-bold text-slate-800">Acceso Restringido</h2>
                <p>Solo administradores pueden acceder a esta sección.</p>
            </div>
        );
    }

    return (
        <div className="max-w-5xl mx-auto p-4 md:p-8 animate-in fade-in duration-500">
            <header className="mb-8">
                <h1 className="text-3xl font-display font-bold text-slate-900 flex items-center gap-3">
                    <div className="bg-indigo-600 p-2 rounded-xl text-white shadow-lg shadow-indigo-100">
                        <CheckCircle2 size={24} />
                    </div>
                    Gestión de Roles Dinámicos
                </h1>
                <p className="mt-2 text-slate-600 max-w-2xl font-medium">
                    Asigna permisos específicos que prevalecen sobre las configuraciones automáticas.
                    <span className="text-indigo-600 ml-1 italic underline decoration-indigo-200">Los cambios son inmediatos.</span>
                </p>
            </header>

            {/* Notification Bar */}
            {message && (
                <div className={`p-4 mb-6 rounded-xl border flex items-center gap-3 animate-in slide-in-from-top-2 ${message.type === 'success'
                        ? 'bg-emerald-50 text-emerald-700 border-emerald-200 shadow-sm shadow-emerald-50'
                        : 'bg-rose-50 text-rose-700 border-rose-200 shadow-sm shadow-rose-50'
                    }`}>
                    {message.type === 'success' ? <CheckCircle2 size={18} /> : <AlertCircle size={18} />}
                    <span className="flex-1 font-semibold">{message.text}</span>
                    <button onClick={() => setMessage(null)} className="p-1 hover:bg-black/5 rounded transition-colors">
                        <X size={16} />
                    </button>
                </div>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
                {/* Form Column */}
                <div className="lg:col-span-4 space-y-6">
                    <div className={`bg-white p-6 rounded-2xl shadow-xl shadow-slate-100 border transition-all duration-500 ${editingEmail ? 'border-indigo-400 ring-8 ring-indigo-50/50' : 'border-slate-200'
                        }`}>
                        <div className="flex items-center justify-between mb-6">
                            <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                                {editingEmail ? <Edit2 size={20} className="text-indigo-600" /> : <UserPlus size={20} className="text-medical-600" />}
                                {editingEmail ? 'Actualizar Usuario' : 'Nuevo Acceso'}
                            </h2>
                            {editingEmail && (
                                <button
                                    onClick={resetForm}
                                    className="text-slate-400 hover:text-rose-500 transition-all hover:rotate-90 duration-300"
                                    title="Cancelar edición"
                                >
                                    <X size={20} />
                                </button>
                            )}
                        </div>

                        <form onSubmit={handleSubmit} className="space-y-4">
                            <div>
                                <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest mb-1.5 px-0.5">
                                    Correo Institucional
                                </label>
                                <input
                                    type="email"
                                    required
                                    readOnly={!!editingEmail}
                                    value={email}
                                    onChange={(e) => setEmail(e.target.value.toLowerCase().trim())}
                                    placeholder="usuario@hospitalhangaroa.cl"
                                    autoComplete="off"
                                    className={`w-full p-3.5 border rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none transition-all font-medium ${editingEmail ? 'bg-slate-50 text-slate-400 border-slate-200 cursor-default select-none' : 'border-slate-300 bg-white shadow-inner shadow-slate-50'
                                        }`}
                                />
                                {email && !isValidEmail && (
                                    <div className="flex items-center gap-1.5 text-[11px] text-rose-500 mt-2 px-1 font-bold animate-pulse">
                                        <AlertCircle size={12} /> Correo incompleto o inválido
                                    </div>
                                )}
                            </div>

                            <div>
                                <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest mb-1.5 px-0.5">
                                    Rol en el Sistema
                                </label>
                                <select
                                    value={selectedRole}
                                    disabled={processing}
                                    onChange={(e) => setSelectedRole(e.target.value)}
                                    className="w-full p-3.5 border border-slate-300 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none bg-white transition-all cursor-pointer font-medium appearance-none shadow-sm"
                                    style={{ backgroundImage: `url("data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 24 24' stroke='currentColor'%3E%3Cpath stroke-linecap='round' stroke-linejoin='round' stroke-width='2' d='M19 9l-7 7-7-7'/%3E%3C/svg%3E")`, backgroundRepeat: 'no-repeat', backgroundPosition: 'right 1rem center', backgroundSize: '1.25rem' }}
                                >
                                    <option value="viewer">🎨 Invitado (Solo Lectura)</option>
                                    <option value="nurse_hospital">👩‍⚕️ Enfermería</option>
                                    <option value="doctor_urgency">🩺 Médico Urgencia</option>
                                    <option value="admin">🔑 Administrador</option>
                                </select>
                            </div>

                            <button
                                type="submit"
                                disabled={processing || !isValidEmail}
                                className={`w-full p-4 rounded-xl text-white font-bold transition-all shadow-lg active:scale-[0.97] flex items-center justify-center gap-2 group ${processing || !isValidEmail
                                        ? 'bg-slate-200 text-slate-400 cursor-not-allowed shadow-none'
                                        : editingEmail
                                            ? 'bg-indigo-600 hover:bg-indigo-700 shadow-indigo-200'
                                            : 'bg-medical-600 hover:bg-medical-700 shadow-medical-200'
                                    }`}
                            >
                                {processing ? (
                                    <div className="flex items-center gap-2">
                                        <div className="h-4 w-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                                        Guardando...
                                    </div>
                                ) : (
                                    <>
                                        {editingEmail ? <CheckCircle2 size={18} /> : <UserPlus size={18} />}
                                        {editingEmail ? 'Guardar Cambios' : 'Conceder Acceso'}
                                    </>
                                )}
                            </button>
                        </form>
                    </div>

                    <div className="bg-slate-100/50 p-4 rounded-xl border border-slate-200/60 border-dashed backdrop-blur-sm">
                        <div className="flex items-start gap-3">
                            <ShieldAlert size={18} className="text-slate-400 shrink-0 mt-0.5" />
                            <p className="text-[11px] text-slate-500 leading-relaxed font-semibold">
                                LOS CAMBIOS AFECTAN LA SEGURIDAD. Asegúrate de verificar el correo institucional antes de otorgar roles de Administrador o Enfermería.
                            </p>
                        </div>
                    </div>
                </div>

                {/* Table Column */}
                <div className="lg:col-span-8">
                    <div className="bg-white rounded-2xl shadow-xl shadow-slate-100 border border-slate-200 overflow-hidden">
                        <div className="px-6 py-5 bg-slate-50/50 border-b border-slate-200 flex items-center justify-between">
                            <h2 className="text-lg font-bold text-slate-800">Cuentas con Acceso Dinámico</h2>
                            <span className="px-3.5 py-1.5 bg-white border border-slate-200 rounded-full text-[11px] font-black uppercase text-slate-500 shadow-sm tracking-tighter">
                                {Object.keys(roles).length} registros activos
                            </span>
                        </div>

                        {loading ? (
                            <div className="flex flex-col items-center justify-center p-16">
                                <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-indigo-600 mb-4 opacity-50"></div>
                                <span className="text-slate-400 font-bold uppercase tracking-widest text-[10px]">Sincronizando Base de Datos</span>
                            </div>
                        ) : Object.keys(roles).length === 0 ? (
                            <div className="p-20 text-center">
                                <div className="bg-slate-50 w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-6 border-2 border-dashed border-slate-200">
                                    <UserPlus className="text-slate-200" size={40} />
                                </div>
                                <h3 className="text-xl font-bold text-slate-800">No hay accesos dinámicos</h3>
                                <p className="text-slate-500 max-w-xs mx-auto mt-2 font-medium">
                                    Usa el formulario para empezar a registrar usuarios externos o modificar cuentas fijas.
                                </p>
                            </div>
                        ) : (
                            <div className="overflow-x-auto">
                                <table className="w-full text-left border-separate border-spacing-0">
                                    <thead>
                                        <tr className="bg-slate-50/30">
                                            <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] font-display border-b border-slate-100">Usuario</th>
                                            <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] font-display border-b border-slate-100">Nivel de Acceso</th>
                                            <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] font-display text-right border-b border-slate-100">Acciones</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100">
                                        {Object.entries(roles).map(([userEmail, role]) => (
                                            <tr key={userEmail} className={`group hover:bg-slate-50/40 transition-all duration-300 ${editingEmail === userEmail ? 'bg-indigo-50/70' : ''}`}>
                                                <td className="px-6 py-5">
                                                    <div className="font-bold text-slate-700 truncate max-w-[200px] md:max-w-none text-sm" title={userEmail}>
                                                        {userEmail}
                                                    </div>
                                                </td>
                                                <td className="px-6 py-5">
                                                    <span className={`inline-flex items-center px-4 py-1.5 rounded-full text-[10px] font-black tracking-tight ring-1 ring-inset shadow-sm uppercase ${role === 'admin' ? 'bg-indigo-100/50 text-indigo-700 ring-indigo-600/20' :
                                                            role === 'nurse_hospital' ? 'bg-emerald-100/50 text-emerald-700 ring-emerald-600/20' :
                                                                role === 'doctor_urgency' ? 'bg-sky-100/50 text-sky-700 ring-sky-600/20' :
                                                                    'bg-slate-200/50 text-slate-600 ring-slate-400/20'
                                                        }`}>
                                                        {role === 'nurse_hospital' ? 'Enfermería Hospital' :
                                                            role === 'doctor_urgency' ? 'Urgencia' :
                                                                role === 'admin' ? 'Admin Total' :
                                                                    'Invitado'}
                                                    </span>
                                                </td>
                                                <td className="px-6 py-5">
                                                    <div className="flex items-center justify-end gap-1.5 opacity-0 group-hover:opacity-100 transition-all transform translate-x-1 group-hover:translate-x-0">
                                                        <button
                                                            onClick={() => handleEdit(userEmail, role)}
                                                            className="p-2.5 text-indigo-600 hover:bg-indigo-600 hover:text-white rounded-xl transition-all shadow-sm flex items-center"
                                                            title="Editar permisos"
                                                        >
                                                            <Edit2 size={16} />
                                                        </button>
                                                        <button
                                                            onClick={() => handleDeleteClick(userEmail)}
                                                            className="p-2.5 text-rose-500 hover:bg-rose-500 hover:text-white rounded-xl transition-all shadow-sm flex items-center"
                                                            title="Eliminar acceso"
                                                        >
                                                            <Trash2 size={16} />
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

            {/* Custom Confirm Modal - STRICT LOCKED */}
            <BaseModal
                isOpen={!!deleteConfirm}
                onClose={() => !processing && setDeleteConfirm(null)}
                closeOnBackdrop={false}
                title="Protocolo de Eliminación"
                icon={<Trash2 size={18} />}
                headerIconColor="text-rose-500"
                size="sm"
            >
                <div className="space-y-4">
                    <div className="bg-rose-50/70 p-5 rounded-2xl flex gap-4 text-rose-700 border border-rose-100 shadow-inner">
                        <ShieldAlert className="shrink-0 mt-0.5" size={24} />
                        <div>
                            <p className="text-sm font-black uppercase tracking-tight mb-1">Confirmar Revocación</p>
                            <p className="text-sm font-medium leading-relaxed opacity-90">
                                Estás revocando el acceso dinámico de:
                                <span className="block font-black mt-1 text-base">{deleteConfirm}</span>
                            </p>
                        </div>
                    </div>
                    <p className="text-slate-500 text-xs font-semibold px-1">
                        Si el usuario usaba una cuenta fija (`hospitalizados@...`), recuperará su rol por defecto tras esta acción.
                    </p>
                    <div className="flex flex-col gap-3 pt-4">
                        <button
                            onClick={confirmDelete}
                            disabled={processing}
                            className="w-full p-4 bg-rose-600 hover:bg-rose-700 active:bg-rose-800 text-white font-black uppercase tracking-widest text-[11px] rounded-2xl transition-all shadow-xl shadow-rose-100 flex items-center justify-center gap-3"
                        >
                            {processing ? (
                                <>
                                    <div className="h-4 w-4 border-2 border-white/20 border-t-white rounded-full animate-spin"></div>
                                    Borrando...
                                </>
                            ) : (
                                'Confirmar Eliminación'
                            )}
                        </button>
                        <button
                            onClick={() => setDeleteConfirm(null)}
                            disabled={processing}
                            className="w-full p-3.5 bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold rounded-2xl transition-all border border-slate-200/50"
                        >
                            Cancelar Protocolo
                        </button>
                    </div>
                </div>
            </BaseModal>
        </div>
    );
};

export default RoleManagementView;
