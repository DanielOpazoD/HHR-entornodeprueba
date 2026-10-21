import React, { useState, useRef, useEffect, useId } from 'react';
import PasswordInput from '@/components/ui/PasswordInput';
import {
  accountErrorMessage,
  callAccount,
  establishNursingSession,
} from '@/services/auth/nursingAccountService';
import {
  isValidNursingPassword,
  NURSING_PASSWORD_HINT,
  rutUsername,
} from '@/services/auth/nursingPasswordPolicy';

interface Props {
  onSuccess: () => void;
  disabled?: boolean;
  onBusyChange?: (busy: boolean) => void;
}
type Mode = 'login' | 'activation' | 'setup' | 'request' | 'reset';

export default function NursingAccessForm({ onSuccess, disabled, onBusyChange }: Props) {
  const usernameHintId = useId();
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const [mode, setMode] = useState<Mode>('login');
  const [rut, setRut] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [code, setCode] = useState('');
  const [activationToken, setActivationToken] = useState('');
  const [challengeId, setChallengeId] = useState('');
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const choosingPassword = ['activation', 'setup', 'reset'].includes(mode);
  const registering = mode === 'activation' || mode === 'setup';
  const changeMode = (next: Mode) => {
    setMode(next);
    setError('');
    setPassword('');
    setConfirmation('');
    setCode('');
    setActivationToken('');
    setChallengeId('');
    setEmail('');
  };
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy || disabled) return;
    if (choosingPassword && (password !== confirmation || !isValidNursingPassword(password))) {
      setError(`Las claves deben coincidir. ${NURSING_PASSWORD_HINT}`);
      return;
    }
    setBusy(true);
    onBusyChange?.(true);
    setError('');
    try {
      if (mode === 'request') {
        const result = await callAccount<{ challengeId: string }>(
          'requestNursingPasswordRecovery',
          { rut }
        );
        if (mounted.current) {
          setChallengeId(result.challengeId);
          setMode('reset');
        }
        return;
      }
      const action = registering
        ? 'activateNursingAccount'
        : mode === 'reset'
          ? 'resetNursingPassword'
          : 'signInWithRut';
      const result = await establishNursingSession(
        action,
        {
          rut,
          password,
          ...(registering
            ? {
                activationToken: mode === 'setup' ? activationToken : code.trim(),
                recoveryEmail: email.trim(),
              }
            : {}),
          ...(mode === 'reset' ? { code: code.trim(), challengeId } : {}),
        },
        () => mounted.current
      );
      if (!mounted.current) return;
      setPassword('');
      setConfirmation('');
      setCode('');
      if (result?.requiresSetup) {
        setActivationToken(result.activationToken);
        setMode('setup');
        return;
      }
      setActivationToken('');
      setEmail('');
      setChallengeId('');
      onSuccess();
    } catch (failure) {
      if (mounted.current) setError(accountErrorMessage(failure));
    } finally {
      if (mounted.current) setBusy(false);
      onBusyChange?.(false);
    }
  };
  const locked = busy || disabled;
  const input =
    'mt-1.5 min-h-11 w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-base text-slate-900 shadow-sm outline-none transition focus:border-sky-400 focus:ring-2 focus:ring-sky-400/40 disabled:bg-slate-100';
  return (
    <form
      onSubmit={submit}
      className="space-y-3 text-sm text-white"
      aria-label="Ingreso con usuario y contraseña"
    >
      {mode !== 'login' && (
        <p className="font-semibold">
          {mode === 'setup'
            ? 'Primer ingreso: cambia tu clave'
            : mode === 'request' || mode === 'reset'
              ? 'Recuperar mi contraseña'
              : mode === 'activation'
                ? 'Activa tu acceso privado'
                : 'Acceso individual'}
        </p>
      )}
      <label className="block">
        Usuario
        <input
          className={input}
          value={rut}
          onChange={e => setRut(rutUsername(e.target.value))}
          autoComplete="username"
          aria-describedby={usernameHintId}
          placeholder="Ej. 17752753k"
          maxLength={20}
          required
          disabled={locked || mode === 'setup' || mode === 'reset'}
          autoCapitalize="none"
          spellCheck={false}
        />
      </label>
      <p id={usernameHintId} className="text-xs text-white/75">
        Tu RUT con dígito verificador, sin puntos ni guion.
      </p>
      {(mode === 'activation' || mode === 'reset') && (
        <label className="block">
          {mode === 'reset' ? 'Código de recuperación' : 'Código privado de activación'}
          <input
            className={input}
            value={code}
            onChange={e => setCode(e.target.value)}
            autoComplete={mode === 'reset' ? 'one-time-code' : 'off'}
            spellCheck={false}
            maxLength={mode === 'reset' ? 8 : 80}
            inputMode={mode === 'reset' ? 'numeric' : undefined}
            required
            disabled={locked}
          />
        </label>
      )}
      {mode === 'reset' && (
        <p role="status">
          Si la cuenta tiene correo registrado, recibirás un código válido por 10 minutos. Revisa
          también correo no deseado. Si no llega, solicita otro o contacta al administrador.
        </p>
      )}
      {mode !== 'request' && (
        <label className="block">
          {choosingPassword ? 'Elige tu clave personal' : 'Contraseña'}
          <PasswordInput
            key={mode}
            aria-label={choosingPassword ? 'Elige tu clave personal' : 'Contraseña'}
            className={input}
            value={password}
            onChange={e => setPassword(e.target.value)}
            autoComplete={choosingPassword ? 'new-password' : 'current-password'}
            minLength={choosingPassword ? 6 : undefined}
            maxLength={128}
            required
            disabled={locked}
          />
        </label>
      )}
      {choosingPassword && (
        <>
          <p className="text-xs text-white/80">{NURSING_PASSWORD_HINT}</p>
          <label className="block">
            Repite tu nueva clave
            <PasswordInput
              aria-label="Repite tu nueva clave"
              className={input}
              value={confirmation}
              onChange={e => setConfirmation(e.target.value)}
              autoComplete="new-password"
              minLength={6}
              maxLength={128}
              required
              disabled={locked}
            />
          </label>
        </>
      )}
      {registering && (
        <label className="block">
          Correo de recuperación
          <input
            className={input}
            type="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            autoComplete="email"
            maxLength={254}
            required
            disabled={locked}
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
        disabled={locked}
        className="min-h-11 w-full rounded-xl bg-sky-600 px-4 py-2.5 text-base font-semibold text-white shadow-sm transition hover:bg-sky-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-sky-300 disabled:opacity-50"
      >
        {busy
          ? 'Validando…'
          : mode === 'request'
            ? 'Enviar código de recuperación'
            : choosingPassword
              ? 'Establecer clave e ingresar'
              : 'Ingresar'}
      </button>
      <div className="flex flex-wrap justify-between gap-x-4 gap-y-2 text-xs">
        {mode === 'login' ? (
          <>
            <button
              type="button"
              disabled={locked}
              onClick={() => changeMode('request')}
              className="underline"
            >
              Olvidé mi contraseña
            </button>
            <button
              type="button"
              disabled={locked}
              onClick={() => changeMode('activation')}
              className="underline"
            >
              Tengo un código de activación
            </button>
          </>
        ) : (
          <button
            type="button"
            disabled={locked}
            onClick={() => changeMode('login')}
            className="underline"
          >
            Volver al ingreso
          </button>
        )}
        {mode === 'reset' && (
          <button
            type="button"
            disabled={locked}
            onClick={() => changeMode('request')}
            className="underline"
          >
            Solicitar otro código
          </button>
        )}
      </div>
      {mode === 'login' && (
        <details className="text-xs leading-relaxed text-white/75">
          <summary className="cursor-pointer py-1">¿Es tu primer ingreso?</summary>
          <p className="mt-2">
            Usa los números de tu RUT, sin dígito verificador, como clave inicial. Deberás cambiarla
            y registrar tu correo antes de entrar.
          </p>
        </details>
      )}
    </form>
  );
}
