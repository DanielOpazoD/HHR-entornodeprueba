import React from 'react';
import { Pencil, RotateCcw, ShieldOff, ShieldCheck, Trash2 } from 'lucide-react';
import type { NursingAccount } from '@/services/auth/nursingAccountService';
import { resolveRoleAccess } from '@/shared/access/roleAccessMatrix';
import { accountButtonClass } from './IndividualAccountFields';

export type AccountAction = 'reset' | 'repair_reset' | 'suspend' | 'enable' | 'delete';
const statuses: Record<NursingAccount['status'], string> = {
  provisioning: 'Preparando',
  pending: 'Primer ingreso pendiente',
  setting_password: 'Configurando clave',
  active: 'Habilitado',
  suspended: 'Deshabilitado',
  retired: 'Eliminado',
};
export default function IndividualAccountsTable({
  accounts,
  busy,
  onEdit,
  onAction,
}: {
  accounts: NursingAccount[];
  busy: boolean;
  onEdit: (account: NursingAccount) => void;
  onAction: (account: NursingAccount, action: AccountAction) => void;
}) {
  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200">
      <table className="w-full text-left text-sm">
        <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
          <tr>
            {['Funcionario', 'RUT', 'Correo de recuperación', 'Rol', 'Estado', 'Acciones'].map(
              label => (
                <th key={label} scope="col" className="px-4 py-3 font-semibold">
                  {label}
                </th>
              )
            )}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {accounts.map(account => (
            <tr key={account.uid} className="align-top hover:bg-slate-50/50">
              <th scope="row" className="px-4 py-4 font-semibold text-slate-900">
                {account.name}
              </th>
              <td className="whitespace-nowrap px-4 py-4 tabular-nums text-slate-600">
                {account.rut}
              </td>
              <td className="px-4 py-4 text-slate-600">
                {account.recoveryEmail || <span className="text-slate-400">Sin registrar</span>}
              </td>
              <td className="px-4 py-4 text-slate-600">{resolveRoleAccess(account.role).label}</td>
              <td className="px-4 py-4">
                <span
                  className={`inline-flex whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium ${account.status === 'active' ? 'bg-emerald-50 text-emerald-800' : account.status === 'suspended' || account.status === 'retired' ? 'bg-slate-100 text-slate-600' : 'bg-amber-50 text-amber-800'}`}
                >
                  {account.status === 'retired' && !account.deletedAt
                    ? 'Acceso retirado (anterior)'
                    : account.status === 'retired' &&
                        (account.recoveryRequired || !account.deletedAt)
                      ? 'Eliminación pendiente'
                      : statuses[account.status]}
                </span>
                {account.recoveryRequired && (
                  <p className="mt-2 text-xs text-amber-800">Operación interrumpida</p>
                )}
              </td>
              <td className="px-4 py-3">
                <div className="flex min-w-52 flex-wrap gap-2">
                  {account.status !== 'retired' && (
                    <>
                      <button
                        className={accountButtonClass}
                        disabled={
                          busy || account.recoveryRequired || account.status === 'setting_password'
                        }
                        onClick={() => onEdit(account)}
                      >
                        <Pencil size={14} aria-hidden="true" />
                        Modificar
                      </button>
                      <button
                        className={accountButtonClass}
                        disabled={
                          busy ||
                          (account.status === 'setting_password' && !account.recoveryRequired)
                        }
                        onClick={() =>
                          onAction(account, account.recoveryRequired ? 'repair_reset' : 'reset')
                        }
                        title="Volver a la clave inicial del RUT"
                      >
                        <RotateCcw size={14} aria-hidden="true" />
                        Resetear
                      </button>
                      {account.status === 'suspended' ? (
                        <button
                          className={accountButtonClass}
                          disabled={busy || account.recoveryRequired || !account.canEnable}
                          onClick={() => onAction(account, 'enable')}
                        >
                          <ShieldCheck size={14} aria-hidden="true" />
                          Habilitar
                        </button>
                      ) : (
                        <button
                          className={accountButtonClass}
                          disabled={busy}
                          onClick={() => onAction(account, 'suspend')}
                        >
                          <ShieldOff size={14} aria-hidden="true" />
                          Deshabilitar
                        </button>
                      )}
                      <button
                        className={`${accountButtonClass} text-red-700 hover:border-red-200 hover:bg-red-50`}
                        disabled={
                          busy || account.recoveryRequired || account.status === 'setting_password'
                        }
                        onClick={() => onAction(account, 'delete')}
                      >
                        <Trash2 size={14} aria-hidden="true" />
                        Eliminar
                      </button>
                    </>
                  )}
                  {account.status === 'retired' &&
                    (account.recoveryRequired || !account.deletedAt) && (
                      <button
                        className={accountButtonClass}
                        disabled={busy}
                        onClick={() => onAction(account, 'delete')}
                      >
                        Completar eliminación
                      </button>
                    )}
                </div>
              </td>
            </tr>
          ))}
          {!accounts.length && (
            <tr>
              <td colSpan={6} className="py-10 text-center text-slate-500">
                No hay usuarios que coincidan con la búsqueda.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
