import React, { useCallback, useEffect, useState } from 'react';
import NursingCandidateImport from './NursingCandidateImport';
import NursingAccountAudit from './NursingAccountAudit';
import { writePrivateClipboardText } from '@/shared/runtime/browserClipboardRuntime';
import { useAuth } from '@/context/AuthContext';
import { useConfirmDialog } from '@/context/UIContext';
import {
  accountErrorMessage,
  callAccount,
  type NursingAccount,
  type NursingAccountList,
  type PrivateActivation,
} from '@/services/auth/nursingAccountService';

const statusLabel: Record<NursingAccount['status'], string> = {
  provisioning: 'Preparando',
  pending: 'Pendiente de activación',
  setting_password: 'Estableciendo clave',
  active: 'Activa',
  suspended: 'Suspendida',
  retired: 'Retirada',
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
  const [name, setName] = useState('');
  const [sourceReference, setSourceReference] = useState('');
  const [recentAudit, setRecentAudit] = useState<NursingAccountList['recentAudit']>([]);
  const [rut, setRut] = useState('');
  const [verified, setVerified] = useState(false);
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [activation, setActivation] = useState<(PrivateActivation & { name: string }) | null>(null);
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
    setActivation(null);
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
      const result = await callAccount<PrivateActivation>('createNursingAccount', {
        name,
        rut,
        identityVerified: verified,
        sourceReference,
      });
      setActivation({ ...result, name });
      setName('');
      setSourceReference('');
      setRut('');
      setVerified(false);
    });
  };
  const manage = async (account: NursingAccount, action: string) => {
    const accepted = await confirm({
      title: `${action === 'recover' ? 'Recuperar activación interrumpida' : action === 'invite' ? 'Restablecer acceso' : action === 'revoke' ? 'Cerrar sesiones' : action === 'retire' ? 'Retirar acceso' : 'Suspender acceso'}: ${account.name}`,
      message:
        action === 'recover'
          ? 'Espera cinco minutos desde la interrupción. Se cerrará la operación anterior y se emitirá un nuevo código privado, conservando la misma identidad.'
          : action === 'invite'
            ? 'Se invalidarán las sesiones y códigos anteriores. Entrega el nuevo código únicamente a la persona después de verificar su identidad.'
            : 'Se invalidará su acceso vigente. Las autorías y registros históricos se conservarán.',
      confirmText: 'Confirmar',
      cancelText: 'Volver',
      variant: 'info',
    });
    if (!accepted) return;
    void run(async () => {
      const result = await callAccount<PrivateActivation | { success: boolean }>(
        'manageNursingAccount',
        { uid: account.uid, action }
      );
      if ('activationToken' in result) setActivation({ ...result, name: account.name });
      else setMessage('Acceso actualizado.');
    });
  };
  const cutover = async () => {
    const accepted = await confirm({
      title: 'Usar sólo cuentas individuales y los dos accesos Google',
      message:
        'Los demás accesos antiguos dejarán de entrar a HHR. Se comprobarán ambos Google y se conservarán identidades e históricos, sin borrar cuentas de otras aplicaciones. Completa antes el piloto de enfermería.',
      confirmText: 'Retirar accesos antiguos a HHR',
      cancelText: 'Volver',
      variant: 'info',
    });
    if (accepted)
      void run(async () => {
        await callAccount('enableIndividualAccounts');
        setMessage('Accesos individuales habilitados; los dos Google se conservan.');
      });
  };
  if (role !== 'admin') return null;
  const visible = accounts.filter(account =>
    `${account.name} ${account.rut}`.toLowerCase().includes(search.toLowerCase())
  );
  return (
    <section
      className="mb-8 space-y-4 rounded-2xl border border-slate-200 bg-white p-5"
      aria-labelledby="nursing-accounts-title"
    >
      <div className="flex items-center justify-between gap-3">
        <h2 id="nursing-accounts-title" className="text-xl font-bold">
          Usuarios de enfermería
        </h2>
        <button disabled={busy} onClick={() => void run(reload)} className="text-sm text-sky-800">
          Actualizar
        </button>
      </div>
      <p className="text-sm text-slate-600">
        Una cuenta por persona. El RUT identifica; cada funcionario elige su clave en privado. Los
        dos accesos Google se conservan.
      </p>
      {message && (
        <p role="status" className="rounded bg-slate-100 p-3 text-sm">
          {message}
        </p>
      )}
      {activation && (
        <div role="status" className="space-y-2 rounded-lg border border-amber-300 bg-amber-50 p-4">
          <p className="font-semibold">Activación privada para {activation.name}</p>
          <p className="text-sm">
            Entrega individual después de comprobar identidad. Un solo uso; vence a las{' '}
            {new Date(activation.expiresAt).toLocaleTimeString()}. Este código no es su contraseña.
          </p>
          <input
            aria-label="Código privado de activación"
            readOnly
            value={activation.activationToken}
            autoComplete="off"
            className="w-full rounded border p-2 font-mono text-xs"
          />
          <div className="flex gap-4">
            <button
              onClick={() =>
                void writePrivateClipboardText(activation.activationToken).catch(() =>
                  setMessage('Selecciona y copia el código manualmente.')
                )
              }
            >
              Copiar código
            </button>
            <button onClick={() => setActivation(null)}>Ya lo entregué: ocultar</button>
          </div>
        </div>
      )}
      <NursingCandidateImport
        existingRuts={accounts.map(account => account.rut)}
        onSelect={row => {
          setName(row.name);
          setRut(row.rut);
          setSourceReference(row.sourceReference);
          setVerified(false);
        }}
      />
      <form onSubmit={create} className="grid gap-3 rounded-lg bg-slate-50 p-4 sm:grid-cols-2">
        <label>
          Nombre verificado
          <input
            value={name}
            onChange={e => setName(e.target.value)}
            minLength={3}
            maxLength={120}
            required
            disabled={busy}
            className="mt-1 block w-full rounded border bg-white p-2"
          />
        </label>
        <label>
          RUT con DV
          <input
            value={rut}
            onChange={e => setRut(e.target.value)}
            maxLength={20}
            required
            disabled={busy}
            autoComplete="off"
            className="mt-1 block w-full rounded border bg-white p-2"
          />
        </label>
        <label className="sm:col-span-2">
          Referencia verificada del funcionario
          <input
            value={sourceReference}
            onChange={event => setSourceReference(event.target.value)}
            maxLength={120}
            minLength={3}
            required
            disabled={busy}
            className="mt-1 block w-full rounded border p-2"
            placeholder="Registro del mantenedor o verificación individual"
          />
        </label>
        <label className="flex gap-2 text-sm sm:col-span-2">
          <input
            type="checkbox"
            checked={verified}
            onChange={e => setVerified(e.target.checked)}
            required
            disabled={busy}
          />
          Verifiqué identidad, RUT y vigencia del funcionario. Una coincidencia de nombre no basta.
        </label>
        <button
          disabled={busy || !verified}
          className="rounded bg-sky-800 px-4 py-2 text-white disabled:opacity-50 sm:col-span-2"
        >
          Crear cuenta y activación privada
        </button>
      </form>
      <label className="block text-sm">
        Buscar nombre o RUT
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          autoComplete="off"
          className="ml-2 rounded border p-2"
        />
      </label>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr>
              <th className="p-2">Funcionario</th>
              <th className="p-2">RUT</th>
              <th className="p-2">Estado</th>
              <th className="p-2">Acceso</th>
            </tr>
          </thead>
          <tbody>
            {visible.map(account => (
              <tr key={account.uid} className="border-t">
                <td className="p-2">{account.name}</td>
                <td className="p-2">{account.rut}</td>
                <td className="p-2">{statusLabel[account.status]}</td>
                <td className="flex flex-wrap gap-3 p-2">
                  {account.status !== 'retired' && (
                    <>
                      <button
                        disabled={
                          busy || account.recoveryRequired || account.status === 'setting_password'
                        }
                        onClick={() => void manage(account, 'invite')}
                      >
                        Nueva activación
                      </button>
                      {account.recoveryRequired && (
                        <button disabled={busy} onClick={() => void manage(account, 'recover')}>
                          Recuperar activación interrumpida
                        </button>
                      )}
                      <button disabled={busy} onClick={() => void manage(account, 'suspend')}>
                        Suspender
                      </button>
                      <button disabled={busy} onClick={() => void manage(account, 'revoke')}>
                        Cerrar sesiones
                      </button>
                      <button disabled={busy} onClick={() => void manage(account, 'retire')}>
                        Retirar
                      </button>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <NursingAccountAudit events={recentAudit} accounts={accounts} />
      <div className="border-t pt-4 text-sm">
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
    </section>
  );
}
