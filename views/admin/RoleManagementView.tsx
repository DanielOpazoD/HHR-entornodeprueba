import React, { useState, useEffect } from 'react';
import { Edit2, Trash2, UserPlus, X, ShieldAlert, CheckCircle2 } from 'lucide-react';
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
            setMessage({ type: 'error', text: 'Error al cargar los roles de la base de datos.' });
        } finally {
            setLoading(false);
        }
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!email || processing) return;

        setProcessing(true);
        setMessage(null);

        try {
            // Save to Firestore
            await roleService.setRole(email, selectedRole);

            // Force sync via Cloud Function (Optional - helps apply changes immediately if user is active)
            try {
                // If in DEV and no emulator host, skip sync attempt to avoid connection errors
                const skipSync = import.meta.env.DEV && !import.meta.env.VITE_FUNCTIONS_EMULATOR_HOST;

                if (!skipSync) {
                    await roleService.forceSyncUser(email, selectedRole);
                    setMessage({
                        type: 'success',
                        text: editingEmail
                            ? `Rol actualizado correctamente para ${email}.`
                            : `Usuario ${email} agregado con éxito.`
                    });
                } else {
                    // Sync skipped because no emulator, but Firestore part worked
                    setMessage({
                        type: 'success',
                        text: editingEmail ? 'Rol actualizado en la base de datos.' : 'Usuario guardado.'
                    });
                }
            } catch (syncError) {
                console.warn('[RoleManagement] Sync trace (non-critical):', syncError);
                // Still show success because Firestore part worked
                setMessage({
                    type: 'success',
                    text: `Datos guardados en la nube. Los cambios se aplicarán en el siguiente inicio de sesión.`
                });
            }

            // Reset form
            resetForm();
            await loadRoles();
        } catch (error) {
            console.error('Error saving role:', error);
            setMessage({ type: 'error', text: 'No se pudo guardar el rol. Por favor, reintenta.' });
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
    };

    const handleDeleteClick = (targetEmail: string) => {
        setDeleteConfirm(targetEmail);
    };

    const confirmDelete = async () => {
        if (!deleteConfirm) return;

        setProcessing(true);
        try {
            await roleService.removeRole(deleteConfirm);
            setMessage({ type: 'success', text: `El usuario ${deleteConfirm} ha sido eliminado.` });
            setDeleteConfirm(null);
            await loadRoles();
        } catch (error) {
            console.error('Error removing role:', error);
            setMessage({ type: 'error', text: 'Error al eliminar el usuario.' });
        } finally {
            setProcessing(false);
        }
    };

    if (userRole !== 'admin') {
        return (
            <div className="flex flex-col items-center justify-center p-12 text-slate-500">
                <ShieldAlert size={48} className="text-red-400 mb-4" />
                <h2 className="text-xl font-bold text-slate-800">Acceso Restringido</h2>
                <p>Solo los administradores pueden gestionar los roles del sistema.</p>
            </div>
        );
    }

    return (
        <div className="max-w-5xl mx-auto p-4 md:p-8 animate-in fade-in duration-500">
            <header className="mb-8">
                <h1 className="text-3xl font-display font-bold text-slate-900 flex items-center gap-3">
                    <div className="bg-indigo-600 p-2 rounded-xl text-white">
                        <CheckCircle2 size={24} />
                    </div>
                    Gestión de Roles Dinámicos
                </h1>
                <p className="mt-2 text-slate-600 max-w-2xl">
                    Administra quién puede acceder al sistema y qué funciones puede realizar. Los cambios se aplican en tiempo real.
                </p>
            </header>

            {/* Notification Bar */}
            {message && (
                <div className={`p-4 mb-6 rounded-xl border flex items-center gap-3 animate-in slide-in-from-top-2 ${message.type === 'success'
                    ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                    : 'bg-rose-50 text-rose-700 border-rose-200'
                    }`}>
                    {message.type === 'success' ? <CheckCircle2 size={18} /> : <ShieldAlert size={18} />}
                    <span className="flex-1 font-medium">{message.text}</span>
                    <button onClick={() => setMessage(null)} className="p-1 hover:bg-black/5 rounded">
                        <X size={16} />
                    </button>
                </div>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
                {/* Form Column */}
                <div className="lg:col-span-4 space-y-6">
                    <div className={`bg-white p-6 rounded-2xl shadow-sm border transition-all duration-300 ${editingEmail ? 'border-indigo-400 ring-4 ring-indigo-50' : 'border-slate-200'
                        }`}>
                        <div className="flex items-center justify-between mb-6">
                            <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                                {editingEmail ? <Edit2 size={20} className="text-indigo-600" /> : <UserPlus size={20} className="text-medical-600" />}
                                {editingEmail ? 'Actualizar Usuario' : 'Nuevo Usuario'}
                            </h2>
                            {editingEmail && (
                                <button
                                    onClick={resetForm}
                                    className="text-slate-400 hover:text-rose-500 transition-colors"
                                    title="Cancelar edición"
                                >
                                    <X size={20} />
                                </button>
                            )}
                        </div>

                        <form onSubmit={handleSubmit} className="space-y-4">
                            <div>
                                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1 px-1">
                                    Correo Institucional
                                </label>
                                <input
                                    type="email"
                                    required
                                    disabled={!!editingEmail || processing}
                                    value={email}
                                    onChange={(e) => setEmail(e.target.value.toLowerCase().trim())}
                                    placeholder="usuario@hospitalhangaroa.cl"
                                    className={`w-full p-3 border rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none transition-all ${editingEmail ? 'bg-slate-50 text-slate-400 border-slate-200' : 'border-slate-300 bg-white'
                                        }`}
                                />
                            </div>

                            <div>
                                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1 px-1">
                                    Rol en el Sistema
                                </label>
                                <select
                                    value={selectedRole}
                                    disabled={processing}
                                    onChange={(e) => setSelectedRole(e.target.value)}
                                    className="w-full p-3 border border-slate-300 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none bg-white transition-all"
                                >
                                    <option value="viewer">🎨 Invitado (Solo Lectura)</option>
                                    <option value="nurse_hospital">👩‍⚕️ Enfermería</option>
                                    <option value="doctor_urgency">🩺 Médico Urgencia</option>
                                    <option value="admin">🔑 Administrador</option>
                                </select>
                            </div>

                            <button
                                type="submit"
                                disabled={processing}
                                className={`w-full p-4 rounded-xl text-white font-bold transition-all shadow-md active:scale-[0.98] ${processing
                                    ? 'bg-slate-300 cursor-not-allowed'
                                    : editingEmail
                                        ? 'bg-indigo-600 hover:bg-indigo-700 shadow-indigo-200'
                                        : 'bg-medical-600 hover:bg-medical-700 shadow-medical-200'
                                    }`}
                            >
                                {processing ? 'Procesando...' : editingEmail ? 'Guardar Cambios' : 'Añadir Usuario'}
                            </button>
                        </form>
                    </div>

                    <div className="bg-slate-100 p-4 rounded-xl border border-slate-200">
                        <div className="flex items-start gap-3">
                            <ShieldAlert size={18} className="text-slate-400 shrink-0 mt-0.5" />
                            <p className="text-xs text-slate-500 leading-relaxed font-medium">
                                <strong>Nota:</strong> Los usuarios con dominios institucionales que ya funcionan por defecto pueden ser registrados aquí para recibir permisos adicionales o cambiar su nivel de acceso de forma permanente.
                            </p>
                        </div>
                    </div>
                </div>

                {/* Table Column */}
                <div className="lg:col-span-8">
                    <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
                        <div className="px-6 py-4 bg-slate-50/50 border-b border-slate-200 flex items-center justify-between">
                            <h2 className="text-lg font-bold text-slate-800">Cuentas con Acceso Dinámico</h2>
                            <span className="px-3 py-1 bg-white border border-slate-200 rounded-full text-xs font-bold text-slate-500">
                                {Object.keys(roles).length} registros
                            </span>
                        </div>

                        {loading ? (
                            <div className="flex flex-col items-center justify-center p-12">
                                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600 mb-4"></div>
                                <span className="text-slate-400 font-medium">Sincronizando con la nube...</span>
                            </div>
                        ) : Object.keys(roles).length === 0 ? (
                            <div className="p-16 text-center">
                                <div className="bg-slate-50 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4 border border-slate-200">
                                    <UserPlus className="text-slate-300" size={32} />
                                </div>
                                <h3 className="text-lg font-bold text-slate-800">Sin usuarios registrados</h3>
                                <p className="text-slate-500 max-w-xs mx-auto mt-2">
                                    Usa el formulario de la izquierda para empezar a dar acceso a nuevos correos.
                                </p>
                            </div>
                        ) : (
                            <div className="overflow-x-auto">
                                <table className="w-full text-left">
                                    <thead>
                                        <tr className="border-b border-slate-100 bg-slate-50/30">
                                            <th className="px-6 py-4 text-xs font-bold text-slate-400 uppercase tracking-widest font-display">Usuario</th>
                                            <th className="px-6 py-4 text-xs font-bold text-slate-400 uppercase tracking-widest font-display">Nivel de Acceso</th>
                                            <th className="px-6 py-4 text-xs font-bold text-slate-400 uppercase tracking-widest font-display text-right">Acciones</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100">
                                        {Object.entries(roles).map(([userEmail, role]) => (
                                            <tr key={userEmail} className={`group hover:bg-slate-50/80 transition-all ${editingEmail === userEmail ? 'bg-indigo-50/50' : ''}`}>
                                                <td className="px-6 py-5">
                                                    <div className="font-bold text-slate-700">{userEmail}</div>
                                                </td>
                                                <td className="px-6 py-5">
                                                    <span className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-bold ring-1 ring-inset ${role === 'admin' ? 'bg-indigo-50 text-indigo-700 ring-indigo-600/20' :
                                                        role === 'nurse_hospital' ? 'bg-emerald-50 text-emerald-700 ring-emerald-600/20' :
                                                            role === 'doctor_urgency' ? 'bg-sky-50 text-sky-700 ring-sky-600/20' :
                                                                'bg-slate-100 text-slate-600 ring-slate-400/20'
                                                        }`}>
                                                        {role === 'nurse_hospital' ? 'Enfermería Hospitalizados' :
                                                            role === 'doctor_urgency' ? 'Médico de Urgencia' :
                                                                role === 'admin' ? 'Administrador Total' :
                                                                    'Invitado (Censo)'}
                                                    </span>
                                                </td>
                                                <td className="px-6 py-5">
                                                    <div className="flex items-center justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                                        <button
                                                            onClick={() => handleEdit(userEmail, role)}
                                                            className="p-2 text-indigo-600 hover:bg-indigo-50 rounded-lg transition-all"
                                                            title="Editar permisos"
                                                        >
                                                            <Edit2 size={18} />
                                                        </button>
                                                        <button
                                                            onClick={() => handleDeleteClick(userEmail)}
                                                            className="p-2 text-rose-500 hover:bg-rose-50 rounded-lg transition-all"
                                                            title="Eliminar acceso"
                                                        >
                                                            <Trash2 size={18} />
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

            {/* Custom Confirm Modal */}
            <BaseModal
                isOpen={!!deleteConfirm}
                onClose={() => setDeleteConfirm(null)}
                title="Confirmar Eliminación"
                icon={<Trash2 size={18} />}
                headerIconColor="text-rose-500"
                size="sm"
            >
                <div className="space-y-4">
                    <div className="bg-rose-50 p-4 rounded-xl flex gap-3 text-rose-700 border border-rose-100">
                        <ShieldAlert className="shrink-0" size={20} />
                        <p className="text-sm font-medium leading-relaxed">
                            Estás a punto de quitar el acceso dinámico para <strong>{deleteConfirm}</strong>.
                        </p>
                    </div>
                    <p className="text-slate-600 text-sm">
                        Esta acción revocará sus permisos configurados manualmente. Si el usuario pertenece a una cuenta institucional fija, recuperará su rol por defecto.
                    </p>
                    <div className="flex flex-col gap-2 pt-2">
                        <button
                            onClick={confirmDelete}
                            disabled={processing}
                            className="w-full p-3 bg-rose-600 hover:bg-rose-700 text-white font-bold rounded-xl transition-all shadow-md shadow-rose-200 flex items-center justify-center gap-2"
                        >
                            {processing ? 'Eliminando...' : 'Eliminar Permanentemente'}
                        </button>
                        <button
                            onClick={() => setDeleteConfirm(null)}
                            disabled={processing}
                            className="w-full p-3 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-xl transition-all"
                        >
                            Cancelar
                        </button>
                    </div>
                </div>
            </BaseModal>
        </div>
    );
};

export default RoleManagementView;
