import React from 'react';
import { Pencil, RotateCcw, ShieldOff, ShieldCheck, Trash2 } from 'lucide-react';
import type { NursingAccount } from '@/services/auth/nursingAccountService';
import { resolveRoleAccess } from '@/shared/access/roleAccessMatrix';
const accountIconButtonClass =
  'inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-slate-200 bg-white transition hover:border-slate-300 hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-600 disabled:cursor-not-allowed disabled:opacity-40';

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
    <div
      className="overflow-x-auto rounded-xl border border-slate-200"
      role="region"
      aria-label="Lista de funcionarios"
      tabIndex={0}
    >
      <table className="w-full text-left text-sm">
        <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
          <tr>
            {['Funcionario', 'RUT', 'Correo de recuperación', 'Rol', 'Estado', 'Acciones'].map(
              label => (
                <th key={label} scope="col" className="whitespace-nowrap px-3 py-2.5 font-semibold">
                  {label}
                </th>
              )
            )}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {accounts.map(account => (
            <tr key={account.uid} className="align-middle hover:bg-slate-50/50">
              <th scope="row" className="whitespace-nowrap px-3 py-2 font-semibold text-slate-900">
                {account.name}
              </th>
              <td className="whitespace-nowrap px-3 py-2 tabular-nums text-slate-600">
                {account.rut}
              </td>
              <td className="whitespace-nowrap px-3 py-2 text-slate-600">
                {account.recoveryEmail || <span className="text-slate-400">Sin registrar</span>}
              </td>
              <td className="whitespace-nowrap px-3 py-2 text-slate-600">
                {resolveRoleAccess(account.role).label}
              </td>
              <td className="px-3 py-2">
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
              <td className="w-px px-3 py-2">
                <div className="inline-flex flex-nowrap items-center gap-1">
                  {account.status !== 'retired' && (
                    <>
                      <button
                        className={`${accountIconButtonClass} text-slate-600`}
                        disabled={
                          busy || account.recoveryRequired || account.status === 'setting_password'
                        }
                        onClick={() => onEdit(account)}
                        type="button"
                        aria-label="Modificar"
                        title="Modificar nombre y rol"
                      >
                        <Pencil size={14} aria-hidden="true" />
                      </button>
                      <button
                        className={`${accountIconButtonClass} text-slate-600`}
                        disabled={
                          busy ||
                          (account.status === 'setting_password' && !account.recoveryRequired)
                        }
                        onClick={() =>
                          onAction(account, account.recoveryRequired ? 'repair_reset' : 'reset')
                        }
                        type="button"
                        aria-label="Resetear"
                        title="Resetear: volver a la clave inicial del RUT"
                      >
                        <RotateCcw size={14} aria-hidden="true" />
                      </button>
                      {account.status === 'suspended' ? (
                        <button
                          className={`${accountIconButtonClass} text-slate-600`}
                          disabled={busy || account.recoveryRequired || !account.canEnable}
                          onClick={() => onAction(account, 'enable')}
                          type="button"
                          aria-label="Habilitar"
                          title="Habilitar el ingreso"
                        >
                          <ShieldCheck size={14} aria-hidden="true" />
                        </button>
                      ) : (
                        <button
                          className={`${accountIconButtonClass} text-slate-600`}
                          disabled={busy}
                          onClick={() => onAction(account, 'suspend')}
                          type="button"
                          aria-label="Deshabilitar"
                          title="Deshabilitar el ingreso"
                        >
                          <ShieldOff size={14} aria-hidden="true" />
                        </button>
                      )}
                      <button
                        className={`${accountIconButtonClass} text-red-700 hover:border-red-200 hover:bg-red-50`}
                        disabled={
                          busy || account.recoveryRequired || account.status === 'setting_password'
                        }
                        onClick={() => onAction(account, 'delete')}
                        type="button"
                        aria-label="Eliminar"
                        title="Eliminar cuenta de acceso"
                      >
                        <Trash2 size={14} aria-hidden="true" />
                      </button>
                    </>
                  )}
                  {account.status === 'retired' &&
                    (account.recoveryRequired || !account.deletedAt) && (
                      <button
                        className={`${accountIconButtonClass} text-red-700 hover:border-red-200 hover:bg-red-50`}
                        disabled={busy}
                        onClick={() => onAction(account, 'delete')}
                        type="button"
                        aria-label="Completar eliminación"
                        title="Completar eliminación pendiente"
                      >
                        <Trash2 size={14} aria-hidden="true" />
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
