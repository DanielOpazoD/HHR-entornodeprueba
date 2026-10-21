import React, { useCallback, useEffect, useState } from 'react';
import { Plus, RefreshCw, Search } from 'lucide-react';
import NursingCandidateImport from './NursingCandidateImport';
import NursingAccountAudit from './NursingAccountAudit';
import IndividualAccountFields, {
  accountButtonClass,
  accountInputClass,
} from './IndividualAccountFields';
import IndividualAccountsTable, { type AccountAction } from './IndividualAccountsTable';
import { useAuth } from '@/context/AuthContext';
import { useConfirmDialog } from '@/context/UIContext';
import {
  accountErrorMessage,
  callAccount,
  type NursingAccount,
  type NursingAccountList,
} from '@/services/auth/nursingAccountService';
import { type ManagedUserRole } from '@/shared/access/roleAccessMatrix';

const actionCopy: Record<AccountAction, { title: string; message: string; done: string }> = {
  reset: {
    title: 'Resetear contraseña',
    message:
      'La clave volverá a ser los números del RUT sin dígito verificador. Al ingresar deberá elegir una nueva clave y registrar su correo. Se cerrarán las sesiones anteriores.',
    done: 'Clave inicial restablecida. El próximo ingreso exige nueva contraseña y correo.',
  },
  repair_reset: {
    title: 'Resetear acceso interrumpido',
    message:
      'Se recuperará la operación y se restablecerá la clave inicial del RUT. Deben haber pasado cinco minutos desde la interrupción. El próximo ingreso exige nueva clave y correo.',
    done: 'Acceso recuperado con clave inicial.',
  },
  suspend: {
    title: 'Deshabilitar usuario',
    message:
      'No podrá ingresar y se cerrarán sus sesiones. Podrás habilitarlo nuevamente. Sus registros y autorías se conservan.',
    done: 'Usuario deshabilitado.',
  },
  enable: {
    title: 'Habilitar usuario',
    message:
      'Podrá volver a ingresar con su contraseña actual. Si no completó el primer ingreso, deberá completarlo.',
    done: 'Usuario habilitado.',
  },
  delete: {
    title: 'Eliminar usuario',
    message:
      'Se eliminará su cuenta de acceso. Sus registros de trabajo y autorías se conservarán, junto con la constancia de eliminación. No podrá ingresar ni habilitarse desde esta lista.',
    done: 'Usuario eliminado. Se conservaron sus registros y autorías.',
  },
};

export default function NursingAccountsPanel({
  onPolicyChange,
}: {
  onPolicyChange?: (enabled: boolean) => void;
}) {
  const { role } = useAuth();
  const { confirm } = useConfirmDialog();
  const [accounts, setAccounts] = useState<NursingAccount[]>([]);
  const [individualOnly, setIndividualOnly] = useState(false);
  const [recentAudit, setRecentAudit] = useState<NursingAccountList['recentAudit']>([]);
  const [name, setName] = useState('');
  const [accountRole, setAccountRole] = useState<ManagedUserRole>('nurse_hospital');
  const [sourceReference, setSourceReference] = useState('');
  const [rut, setRut] = useState('');
  const [verified, setVerified] = useState(false);
  const [search, setSearch] = useState('');
  const [showDeleted, setShowDeleted] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [editing, setEditing] = useState<NursingAccount | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const reload = useCallback(async () => {
    const result = await callAccount<NursingAccountList>('listNursingAccounts');
    setAccounts(result.accounts);
    setRecentAudit(result.recentAudit);
    setIndividualOnly(result.individualOnly);
    onPolicyChange?.(result.individualOnly);
  }, [onPolicyChange]);
  useEffect(() => {
    if (role === 'admin') void reload().catch(error => setMessage(accountErrorMessage(error)));
  }, [reload, role]);
  const run = async (action: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setMessage('');
    try {
      await action();
      await reload();
    } catch (error) {
      setMessage(accountErrorMessage(error));
    } finally {
      setBusy(false);
    }
  };
  const create = (event: React.FormEvent) => {
    event.preventDefault();
    void run(async () => {
      const result = await callAccount<{ username: string }>('createNursingAccount', {
        name,
        role: accountRole,
        rut,
        identityVerified: verified,
        sourceReference,
      });
      setMessage(
        `Cuenta creada. Usuario: ${result.username}. Clave inicial: números del RUT sin dígito verificador. El primer ingreso exige nueva clave y correo de recuperación.`
      );
      setName('');
      setSourceReference('');
      setRut('');
      setVerified(false);
      setAccountRole('nurse_hospital');
      setShowCreate(false);
    });
  };
  const manage = async (account: NursingAccount, action: AccountAction) => {
    const copy = actionCopy[action];
    if (
      !(await confirm({
        title: `${copy.title}: ${account.name}`,
        message: copy.message,
        confirmText: copy.title,
        cancelText: 'Cancelar',
        variant: 'info',
      }))
    )
      return;
    void run(async () => {
      await callAccount('manageNursingAccount', { uid: account.uid, action });
      setMessage(copy.done);
    });
  };
  const saveEdit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!editing) return;
    void run(async () => {
      await callAccount('manageNursingAccount', {
        uid: editing.uid,
        action: 'update',
        name: editing.name,
        role: editing.role,
      });
      setEditing(null);
      setMessage('Nombre y rol actualizados. El usuario deberá volver a ingresar.');
    });
  };
  const cutover = async () => {
    if (
      !(await confirm({
        title: 'Usar sólo cuentas individuales y los dos accesos Google',
        message:
          'Los demás accesos antiguos dejarán de entrar a HHR. Se comprobarán ambos Google y se conservarán identidades e históricos, sin borrar cuentas de otras aplicaciones. Completa antes el piloto.',
        confirmText: 'Retirar accesos antiguos a HHR',
        cancelText: 'Volver',
        variant: 'info',
      }))
    )
      return;
    void run(async () => {
      await callAccount('enableIndividualAccounts');
      setMessage('Accesos individuales habilitados; los dos Google se conservan.');
    });
  };
  if (role !== 'admin') return null;
  const visible = accounts.filter(
    account =>
      (showDeleted ||
        account.status !== 'retired' ||
        !account.deletedAt ||
        account.recoveryRequired) &&
      `${account.name} ${account.rut} ${account.recoveryEmail || ''}`
        .toLowerCase()
        .includes(search.toLowerCase())
  );
  return (
    <section
      className="mb-8 space-y-5 rounded-2xl border border-slate-200 bg-white p-5 sm:p-6"
      aria-labelledby="nursing-accounts-title"
    >
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 id="nursing-accounts-title" className="text-xl font-bold text-slate-900">
            Usuarios del equipo
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            Cuentas personales, roles y recuperación de acceso.
          </p>
        </div>
        <div className="flex gap-2">
          <button className={accountButtonClass} disabled={busy} onClick={() => void run(reload)}>
            <RefreshCw size={16} aria-hidden="true" />
            Actualizar
          </button>
          <button
            className="inline-flex items-center gap-2 rounded-xl bg-teal-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-teal-800 disabled:opacity-50"
            disabled={busy}
            onClick={() => setShowCreate(!showCreate)}
          >
            <Plus size={16} aria-hidden="true" />
            Nuevo usuario
          </button>
        </div>
      </div>
      {message && (
        <p
          role="status"
          className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700"
        >
          {message}
        </p>
      )}
      {showCreate && (
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
          <h3 className="mb-4 font-semibold text-slate-800">Crear usuario</h3>
          <form onSubmit={create} className="grid gap-4 sm:grid-cols-2">
            <IndividualAccountFields
              name={name}
              role={accountRole}
              onName={setName}
              onRole={setAccountRole}
              disabled={busy}
            />
            <label className="text-sm font-medium text-slate-700">
              RUT con dígito verificador
              <input
                className={accountInputClass}
                value={rut}
                onChange={e => setRut(e.target.value)}
                maxLength={20}
                required
                disabled={busy}
                autoComplete="off"
                placeholder="Ej. 17752753k"
              />
            </label>
            <label className="text-sm font-medium text-slate-700">
              Observación de verificación (opcional)
              <input
                className={accountInputClass}
                value={sourceReference}
                onChange={e => setSourceReference(e.target.value)}
                maxLength={120}
                disabled={busy}
                placeholder="Ej. Identidad confirmada con el funcionario"
              />
              <span className="mt-1 block text-xs font-normal text-slate-500">
                Deja una referencia si consultaste el registro de personal u otro respaldo.
              </span>
            </label>
            <label className="flex items-start gap-2 text-sm text-slate-700 sm:col-span-2">
              <input
                type="checkbox"
                checked={verified}
                onChange={e => setVerified(e.target.checked)}
                required
                disabled={busy}
                className="mt-0.5 h-4 w-4 accent-teal-700"
              />
              Confirmé la identidad, el RUT y que trabaja en el hospital.
            </label>
            <p className="text-xs text-slate-500 sm:col-span-2">
              La clave inicial son los números del RUT sin dígito verificador. El funcionario
              elegirá una clave nueva y registrará su correo al ingresar.
            </p>
            <div className="flex gap-2 sm:col-span-2">
              <button
                disabled={busy || !verified}
                className="rounded-lg bg-teal-700 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-40"
              >
                Crear usuario
              </button>
              <button
                type="button"
                disabled={busy}
                className={accountButtonClass}
                onClick={() => setShowCreate(false)}
              >
                Cancelar
              </button>
            </div>
          </form>
          <details className="mt-4 border-t border-slate-200 pt-3 text-sm">
            <summary className="cursor-pointer text-slate-600">
              Preparar datos desde una lista de funcionarios
            </summary>
            <NursingCandidateImport
              existingRuts={accounts.map(account => account.rut)}
              onSelect={row => {
                setName(row.name);
                setRut(row.rut);
                setSourceReference(row.sourceReference);
                setVerified(false);
              }}
            />
          </details>
        </div>
      )}
      {editing && (
        <form
          onSubmit={saveEdit}
          aria-label={`Modificar usuario: ${editing.name}`}
          className="grid gap-4 rounded-xl border border-teal-200 bg-teal-50/40 p-4 sm:grid-cols-2"
        >
          <h3 className="font-semibold text-slate-900 sm:col-span-2">
            Modificar usuario · {editing.rut}
          </h3>
          <IndividualAccountFields
            name={editing.name}
            role={editing.role}
            onName={value => setEditing({ ...editing, name: value })}
            onRole={value => setEditing({ ...editing, role: value })}
            disabled={busy}
          />
          <p className="text-xs text-slate-600 sm:col-span-2">
            Se conserva su RUT, contraseña y correo. Para aplicar el rol, deberá volver a ingresar.
          </p>
          <div className="flex gap-2 sm:col-span-2">
            <button
              disabled={busy}
              className="rounded-lg bg-teal-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
            >
              Guardar cambios
            </button>
            <button
              type="button"
              disabled={busy}
              className={accountButtonClass}
              onClick={() => setEditing(null)}
            >
              Cancelar
            </button>
          </div>
        </form>
      )}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <label className="w-full text-sm font-medium text-slate-600 sm:max-w-md">
          Buscar funcionario
          <span className="relative mt-1 block">
            <Search
              size={17}
              aria-hidden="true"
              className="absolute left-3 top-3.5 text-slate-400"
            />
            <input
              className={`${accountInputClass} pl-9`}
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Nombre, RUT o correo"
              autoComplete="off"
            />
          </span>
        </label>
        <label className="flex items-center gap-2 py-2 text-xs text-slate-500">
          <input
            type="checkbox"
            checked={showDeleted}
            onChange={e => setShowDeleted(e.target.checked)}
          />
          Mostrar eliminados
        </label>
      </div>
      <IndividualAccountsTable
        accounts={visible}
        busy={busy}
        onEdit={setEditing}
        onAction={(account, action) => void manage(account, action)}
      />
      <NursingAccountAudit events={recentAudit} accounts={accounts} />
      <details className="border-t pt-4 text-sm">
        <summary className="cursor-pointer text-slate-500">
          Opciones de transición de accesos
        </summary>
        <div className="pt-3">
          {individualOnly ? (
            <p>Acceso limitado a cuentas individuales activas y los dos Google protegidos.</p>
          ) : (
            <button
              disabled={busy}
              onClick={() => void cutover()}
              className="rounded border border-amber-600 p-2 text-amber-900"
            >
              Finalizar migración de accesos antiguos
            </button>
          )}
        </div>
      </details>
    </section>
  );
}
