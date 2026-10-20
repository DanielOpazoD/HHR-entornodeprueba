import React, { useState, useRef, useEffect } from 'react';
import {
  accountErrorMessage,
  establishNursingSession,
} from '@/services/auth/nursingAccountService';

export default function NursingPasswordDialog({ onClose }: { onClose: () => void }) {
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const [currentPassword, setCurrentPassword] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (password !== confirmation) {
      setMessage('Las claves nuevas no coinciden.');
      return;
    }
    setBusy(true);
    setMessage('');
    try {
      await establishNursingSession(
        'changeNursingPassword',
        { currentPassword, password },
        () => mounted.current
      );
      setCurrentPassword('');
      setPassword('');
      setConfirmation('');
      setMessage('Clave cambiada. Las otras sesiones han quedado invalidadas.');
    } catch (error) {
      setMessage(accountErrorMessage(error));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="private-password-title"
    >
      <form
        onSubmit={submit}
        className="w-full max-w-md space-y-4 rounded-xl bg-white p-6 text-slate-900"
      >
        <h2 id="private-password-title" className="text-lg font-semibold">
          Cambiar mi clave
        </h2>
        <p className="text-sm">Sólo tú conoces tu clave. El cambio cerrará tus otras sesiones.</p>
        <label className="block">
          Clave actual
          <input
            autoFocus
            type="password"
            autoComplete="current-password"
            value={currentPassword}
            onChange={e => setCurrentPassword(e.target.value)}
            required
            maxLength={128}
            className="block w-full rounded border p-2"
            disabled={busy}
          />
        </label>
        <label className="block">
          Nueva clave
          <input
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            required
            minLength={12}
            maxLength={128}
            className="block w-full rounded border p-2"
            disabled={busy}
          />
        </label>
        <label className="block">
          Repite la nueva clave
          <input
            type="password"
            autoComplete="new-password"
            value={confirmation}
            onChange={e => setConfirmation(e.target.value)}
            required
            minLength={12}
            maxLength={128}
            className="block w-full rounded border p-2"
            disabled={busy}
          />
        </label>
        {message && <p role="status">{message}</p>}
        <div className="flex justify-end gap-3">
          <button type="button" disabled={busy} onClick={onClose}>
            Cerrar
          </button>
          <button disabled={busy} className="rounded bg-sky-700 px-4 py-2 text-white">
            {busy ? 'Cambiando…' : 'Cambiar clave'}
          </button>
        </div>
      </form>
    </div>
  );
}
