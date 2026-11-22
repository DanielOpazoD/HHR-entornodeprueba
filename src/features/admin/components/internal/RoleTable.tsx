import React from 'react';
import { Search, UserPlus, Edit2, Trash2 } from 'lucide-react';
import { UserRoleMap } from '@/features/admin/services/roleService';
import { resolveRoleAccess } from '@/shared/access/roleAccessMatrix';

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
  onDelete,
}) => {
  const rolesCount = Object.keys(roles).length;
  const sortedRoles = Object.entries(roles).sort(([left], [right]) => left.localeCompare(right));

  return (
    <div className="bg-white rounded-[1.75rem] shadow-xl border border-slate-100 overflow-hidden flex flex-col h-full">
      <div className="px-5 py-4 bg-slate-50/50 border-b border-slate-100 flex items-center justify-between">
        <h2 className="text-lg font-black text-slate-800 flex items-center gap-2.5">
          <Search size={18} className="text-slate-400" />
          Cuentas Autorizadas
        </h2>
        <div className="bg-white px-3 py-1.5 border border-slate-100 rounded-full text-[10px] font-black text-indigo-600 uppercase shadow-sm tracking-widest">
          {rolesCount} Registros
        </div>
      </div>

      {loading ? (
        <div className="flex-1 flex flex-col items-center justify-center p-16">
          <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-indigo-600 mb-4 opacity-30"></div>
          <span className="text-slate-300 font-bold uppercase tracking-[0.4em] text-[9px]">
            Sincronizando con Firestore
          </span>
        </div>
      ) : rolesCount === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center p-16 text-center">
          <div className="bg-slate-50 w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-5 border-4 border-dashed border-slate-100">
            <UserPlus className="text-slate-200" size={40} />
          </div>
          <h3 className="text-xl font-black text-slate-800">No hay configuraciones</h3>
          <p className="text-slate-400 max-w-sm mx-auto mt-2 font-medium text-sm">
            Usa el formulario para agregar accesos por correo institucional.
          </p>
        </div>
      ) : (
        <div className="overflow-hidden">
          <table className="w-full table-fixed text-left">
            <colgroup>
              <col className="w-[45%]" />
              <col className="w-[20%]" />
              <col className="w-[35%]" />
            </colgroup>
            <thead>
              <tr className="bg-slate-50/10">
                <th className="px-5 py-4 text-[10px] font-black text-slate-400 uppercase tracking-[0.18em] border-b border-slate-50">
                  Correo
                </th>
                <th className="px-4 py-4 text-[10px] font-black text-slate-400 uppercase tracking-[0.18em] border-b border-slate-50">
                  Acceso
                </th>
                <th className="px-5 py-4 text-[10px] font-black text-slate-400 uppercase tracking-[0.18em] text-right border-b border-slate-50">
                  Acciones
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {sortedRoles.map(([userEmail, role]) => {
                const roleAccess = resolveRoleAccess(role);
                const canEditRole = roleAccess.assignableInRoleManagement;
                return (
                  <tr
                    key={userEmail}
                    className={`transition-all duration-300 ${editingEmail === userEmail ? 'bg-indigo-50' : 'hover:bg-slate-50/50'}`}
                  >
                    <td className="px-5 py-4 align-middle">
                      <div
                        className="font-black text-slate-700 text-[13px] leading-tight tracking-tight break-all pr-3"
                        title={userEmail}
                      >
                        {userEmail}
                      </div>
                    </td>
                    <td className="px-4 py-4 align-middle">
                      <div className="space-y-1">
                        <div
                          className={`px-3 py-1 rounded-2xl text-[10px] font-black inline-flex items-center gap-2 border shadow-sm whitespace-nowrap ${roleAccess.badgeClassName}`}
                        >
                          {roleAccess.badgeLabel}
                        </div>
                        {!canEditRole && (
                          <p className="text-[10px] font-bold text-amber-600">
                            Rol legacy no editable
                          </p>
                        )}
                      </div>
                    </td>
                    <td className="px-5 py-4 align-middle">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => onEdit(userEmail, role)}
                          disabled={!canEditRole}
                          title={
                            canEditRole
                              ? 'Editar acceso'
                              : 'Este rol legacy debe eliminarse y reasignarse con un rol canónico.'
                          }
                          className={`flex items-center gap-1.5 px-3 py-2 border rounded-xl transition-all font-black text-[10px] uppercase tracking-wider shadow-sm whitespace-nowrap ${
                            canEditRole
                              ? 'bg-white text-indigo-600 border-slate-100 hover:bg-indigo-600 hover:text-white hover:border-indigo-600'
                              : 'bg-slate-100 text-slate-400 border-slate-100 cursor-not-allowed shadow-none'
                          }`}
                        >
                          <Edit2 size={12} /> Editar
                        </button>
                        <button
                          onClick={() => onDelete(userEmail)}
                          className="flex items-center gap-1.5 px-3 py-2 bg-white text-rose-500 border border-slate-100 hover:bg-rose-600 hover:text-white hover:border-rose-600 rounded-xl transition-all font-black text-[10px] uppercase tracking-wider shadow-sm whitespace-nowrap"
                        >
                          <Trash2 size={12} /> Quitar
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
