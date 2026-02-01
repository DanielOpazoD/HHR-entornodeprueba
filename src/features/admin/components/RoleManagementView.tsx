import React from 'react';
import { X, CheckCircle2, AlertCircle, RefreshCw, ShieldAlert } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useRoleManagement } from '@/hooks/useRoleManagement';
import { AccessRestricted } from './components/AccessRestricted';
import { RoleForm } from './components/RoleForm';
import { RoleTable } from './components/RoleTable';
import { DeleteRoleModal } from './components/DeleteRoleModal';

const RoleManagementView: React.FC = () => {
    const { role: authRole } = useAuth();
    const {
        roles,
        loading,
        email,
        setEmail,
        selectedRole,
        setSelectedRole,
        editingEmail,
        processing,
        message,
        setMessage,
        deleteConfirm,
        setDeleteConfirm,
        isValidEmail,
        loadRoles,
        handleSubmit,
        handleEdit,
        resetForm,
        handleDeleteClick,
        confirmDelete
    } = useRoleManagement();

    // If authRole is definitively NOT admin (and not undefined/loading), show blocked
    if (authRole !== 'admin' && authRole !== undefined) {
        return <AccessRestricted />;
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
                    <button onClick={() => setMessage(null)} className="p-1 hover:bg-black/5 rounded-full transition-transform active:scale-90" aria-label="Cerrar">
                        <X size={20} />
                    </button>
                </div>
            )}

            <div className="grid grid-cols-1 xl:grid-cols-12 gap-10">
                {/* FORM COLUMN */}
                <div className="xl:col-span-4 space-y-8">
                    <RoleForm
                        email={email}
                        setEmail={setEmail}
                        selectedRole={selectedRole}
                        setSelectedRole={setSelectedRole}
                        editingEmail={editingEmail}
                        processing={processing}
                        isValidEmail={isValidEmail}
                        onReset={resetForm}
                        onSubmit={handleSubmit}
                    />

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
                    <RoleTable
                        roles={roles}
                        loading={loading}
                        editingEmail={editingEmail}
                        onEdit={handleEdit}
                        onDelete={handleDeleteClick}
                    />
                </div>
            </div>

            {/* Confirmation Modal */}
            <DeleteRoleModal
                email={deleteConfirm}
                processing={processing}
                onClose={() => setDeleteConfirm(null)}
                onConfirm={confirmDelete}
            />
        </div>
    );
};

export default RoleManagementView;
