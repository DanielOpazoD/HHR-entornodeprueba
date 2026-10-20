import React, { useState, useRef, useEffect } from 'react';
import {
  accountErrorMessage,
  establishNursingSession,
} from '@/services/auth/nursingAccountService';

interface Props {
  onSuccess: () => void;
  disabled?: boolean;
  onBusyChange?: (busy: boolean) => void;
}

export default function NursingAccessForm({ onSuccess, disabled, onBusyChange }: Props) {
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const [activation, setActivation] = useState(false);
  const [rut, setRut] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy || disabled) return;
    if (activation && (password !== confirmation || password.length < 12)) {
      setError('Las claves deben coincidir y tener al menos 12 caracteres.');
      return;
    }
    setBusy(true);
    onBusyChange?.(true);
    setError('');
    try {
      await establishNursingSession(
        activation ? 'activateNursingAccount' : 'signInWithRut',
        {
          rut,
          password,
          ...(activation ? { activationToken: code.trim() } : {}),
        },
        () => mounted.current
      );
      setCode('');
      setPassword('');
      setConfirmation('');
      onSuccess();
    } catch (failure) {
      setError(accountErrorMessage(failure));
    } finally {
      setBusy(false);
      onBusyChange?.(false);
    }
  };
  const input = 'mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900';
  return (
    <form
      onSubmit={submit}
      className="mt-5 space-y-3 text-sm text-white"
      aria-label="Acceso individual de enfermería"
    >
      <p className="font-semibold">
        {activation ? 'Activa tu acceso privado' : 'Acceso individual'}
      </p>
      <label className="block">
        RUT con dígito verificador
        <input
          className={input}
          value={rut}
          onChange={e => setRut(e.target.value)}
          autoComplete="username"
          maxLength={20}
          required
          disabled={busy || disabled}
        />
      </label>
      {activation && (
        <label className="block">
          Código privado de activación
          <input
            className={input}
            value={code}
            onChange={e => setCode(e.target.value)}
            autoComplete="off"
            spellCheck={false}
            maxLength={80}
            required
            disabled={busy || disabled}
          />
        </label>
      )}
      <label className="block">
        {activation ? 'Elige tu clave personal' : 'Clave'}
        <input
          className={input}
          type="password"
          value={password}
          onChange={e => setPassword(e.target.value)}
          autoComplete={activation ? 'new-password' : 'current-password'}
          minLength={activation ? 12 : undefined}
          maxLength={128}
          required
          disabled={busy || disabled}
        />
      </label>
      {activation && (
        <label className="block">
          Repite tu nueva clave
          <input
            className={input}
            type="password"
            value={confirmation}
            onChange={e => setConfirmation(e.target.value)}
            autoComplete="new-password"
            minLength={12}
            maxLength={128}
            required
            disabled={busy || disabled}
          />
        </label>
      )}
      {error && (
        <p role="alert" className="rounded bg-red-950/50 p-2">
          {error}
        </p>
      )}
      <button
        type="submit"
        disabled={busy || disabled}
        className="w-full rounded-lg bg-sky-600 px-3 py-2 font-semibold disabled:opacity-50"
      >
        {busy
          ? 'Validando acceso…'
          : activation
            ? 'Establecer clave e ingresar'
            : 'Ingresar con RUT'}
      </button>
      <button
        type="button"
        disabled={busy || disabled}
        onClick={() => {
          setActivation(!activation);
          setError('');
          setPassword('');
          setConfirmation('');
          setCode('');
        }}
        className="underline underline-offset-2"
      >
        {activation ? 'Ya tengo una clave' : 'Tengo un código de activación'}
      </button>
      <p className="text-xs text-white/80">
        {activation
          ? 'Código de un solo uso, válido durante una hora. Tu clave es privada; el administrador no puede verla.'
          : 'Si olvidaste tu clave, solicita una nueva activación al administrador. Nunca se usa tu RUT como clave.'}
      </p>
    </form>
  );
}
