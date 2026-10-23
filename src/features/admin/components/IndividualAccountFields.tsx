import React from 'react';
import { getManagedRoleOptions, type ManagedUserRole } from '@/shared/access/roleAccessMatrix';

export const accountInputClass =
  'mt-1.5 block w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none transition focus:border-teal-600 focus:ring-2 focus:ring-teal-600/15 disabled:opacity-50';
export const accountButtonClass =
  'inline-flex items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition hover:border-slate-300 hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-600 disabled:cursor-not-allowed disabled:opacity-40';

export default function IndividualAccountFields({
  name,
  role,
  onName,
  onRole,
  disabled,
}: {
  name: string;
  role: ManagedUserRole;
  onName: (name: string) => void;
  onRole: (role: ManagedUserRole) => void;
  disabled: boolean;
}) {
  return (
    <>
      <label className="text-sm font-medium text-slate-700">
        Nombre completo
        <input
          className={accountInputClass}
          value={name}
          onChange={e => onName(e.target.value)}
          minLength={3}
          maxLength={120}
          required
          disabled={disabled}
        />
      </label>
      <label className="text-sm font-medium text-slate-700">
        Rol
        <select
          className={accountInputClass}
          value={role}
          onChange={e => onRole(e.target.value as ManagedUserRole)}
          disabled={disabled}
        >
          {getManagedRoleOptions().map(option => (
            <option key={option.role} value={option.role}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
    </>
  );
}
