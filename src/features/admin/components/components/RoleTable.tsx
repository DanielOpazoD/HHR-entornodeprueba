import React from 'react';
import { Search, UserPlus, Edit2, Trash2 } from 'lucide-react';
import { UserRoleMap } from '@/services/admin/roleService';

interface RoleTableProps {
    roles: UserRoleMap;
    loading: boolean;
    editingEmail: string | null;
    onEdit: (email: string, role: string) => void;
    onDelete: (email: string) => void;
}

export const RoleTable: React.FC<RoleTableProps> = ({
    roles,
    loading,
    editingEmail,
    onEdit,
    onDelete
}) => {
    const rolesCount = Object.keys(roles).length;

    return (
        <div className="bg-white rounded-[2rem] shadow-xl border border-slate-100 overflow-hidden flex flex-col h-full">
            <div className="px-8 py-6 bg-slate-50/50 border-b border-slate-100 flex items-center justify-between">
                <h2 className="text-xl font-black text-slate-800 flex items-center gap-3">
                    <Search size={22} className="text-slate-400" />
                    Cuentas Autorizadas
                </h2>
                <div className="bg-white px-5 py-2 border-2 border-slate-100 rounded-full text-[10px] font-black text-indigo-600 uppercase shadow-sm tracking-widest">
                    {rolesCount} Registros
                </div>
            </div>

            {loading ? (
                <div className="flex-1 flex flex-col items-center justify-center p-24">
                    <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600 mb-6 opacity-30"></div>
                    <span className="text-slate-300 font-bold uppercase tracking-[0.4em] text-[9px]">Sincronizando con Firestore</span>
                </div>
            ) : rolesCount === 0 ? (
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
                                                onClick={() => onEdit(userEmail, role)}
                                                className="flex items-center gap-2 px-4 py-3 bg-white text-indigo-600 border-2 border-slate-100 hover:bg-indigo-600 hover:text-white hover:border-indigo-600 rounded-2xl transition-all font-black text-[10px] uppercase tracking-widest shadow-sm"
                                            >
                                                <Edit2 size={14} /> Editar
                                            </button>
                                            <button
                                                onClick={() => onDelete(userEmail)}
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
    );
};
