import React, { useState, useRef, useEffect, useId } from 'react';
import { Loader2 } from 'lucide-react';
import { LOGIN_INPUT_CLASS, LOGIN_SUBMIT_CLASS } from '@/components/ui/LoginScreenLayout';
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

const HELP_ACTION_CLASS =
  'text-teal-800 underline decoration-teal-800/35 underline-offset-4 transition hover:text-teal-950 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700';
const LABEL_CLASS = 'block font-medium text-slate-800';

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
  const [showFirstLoginHelp, setShowFirstLoginHelp] = useState(false);
  const firstLoginHelpId = useId();
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
    setShowFirstLoginHelp(false);
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
  const input = LOGIN_INPUT_CLASS;
  return (
    <div className="relative">
      <form
        onSubmit={submit}
        aria-busy={busy}
        autoComplete="off"
        className="space-y-2.5 text-sm text-slate-800"
        aria-label="Ingreso con usuario y contraseña"
      >
        {mode !== 'login' && (
          <p className="rounded-xl border border-teal-100 bg-teal-50 px-3.5 py-3 font-semibold text-teal-950">
            {mode === 'setup'
              ? 'Primer ingreso: cambia tu clave'
              : mode === 'request' || mode === 'reset'
                ? 'Recuperar mi contraseña'
                : mode === 'activation'
                  ? 'Activa tu acceso privado'
                  : 'Acceso individual'}
          </p>
        )}
        {mode === 'activation' && (
          <p className="text-xs leading-5 text-stone-600">
            Si administración te entregó un código, ingrésalo aquí. Si no lo tienes, vuelve al
            ingreso y usa los números de tu RUT, sin dígito verificador, como clave inicial.
          </p>
        )}
        <label className={LABEL_CLASS}>
          Usuario
          <input
            className={input}
            value={rut}
            onChange={e => setRut(rutUsername(e.target.value))}
            autoComplete="off"
            aria-describedby={usernameHintId}
            placeholder="Ej. 111111111"
            maxLength={20}
            required
            disabled={locked || mode === 'setup' || mode === 'reset'}
            autoCapitalize="none"
            spellCheck={false}
          />
        </label>
        <p id={usernameHintId} className="mt-1! text-xs leading-5 text-stone-600">
          RUT con dígito verificador, sin puntos ni guion.
        </p>
        {(mode === 'activation' || mode === 'reset') && (
          <label className={LABEL_CLASS}>
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
          <p
            role="status"
            className="rounded-xl border border-stone-200 bg-stone-50 p-3 text-xs leading-5 text-stone-600"
          >
            Si la cuenta tiene correo registrado, recibirás un código válido por 10 minutos. Revisa
            también correo no deseado. Si no llega, solicita otro o contacta al administrador.
          </p>
        )}
        {mode !== 'request' && (
          <label className={LABEL_CLASS}>
            {choosingPassword ? 'Elige tu clave personal' : 'Contraseña'}
            <PasswordInput
              key={mode}
              aria-label={choosingPassword ? 'Elige tu clave personal' : 'Contraseña'}
              className={input}
              value={password}
              onChange={e => setPassword(e.target.value)}
              autoComplete="off"
              minLength={choosingPassword ? 6 : undefined}
              maxLength={128}
              required
              disabled={locked}
            />
          </label>
        )}
        {choosingPassword && (
          <>
            <p className="text-xs leading-5 text-stone-600">{NURSING_PASSWORD_HINT}</p>
            <label className={LABEL_CLASS}>
              Repite tu nueva clave
              <PasswordInput
                aria-label="Repite tu nueva clave"
                className={input}
                value={confirmation}
                onChange={e => setConfirmation(e.target.value)}
                autoComplete="off"
                minLength={6}
                maxLength={128}
                required
                disabled={locked}
              />
            </label>
          </>
        )}
        {registering && (
          <label className={LABEL_CLASS}>
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
          <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-red-800">
            {error}
          </p>
        )}
        <button type="submit" disabled={locked} className={LOGIN_SUBMIT_CLASS}>
          {busy
            ? 'Validando…'
            : mode === 'request'
              ? 'Enviar código de recuperación'
              : choosingPassword
                ? 'Establecer clave e ingresar'
                : 'Ingresar'}
        </button>
        <div className="flex flex-wrap justify-between gap-x-4 gap-y-2 text-xs text-stone-600">
          {mode === 'login' ? (
            <>
              <button
                type="button"
                disabled={locked}
                onClick={() => changeMode('request')}
                className={`font-medium ${HELP_ACTION_CLASS}`}
              >
                Olvidé mi contraseña
              </button>
              <button
                type="button"
                disabled={locked}
                onClick={() => setShowFirstLoginHelp(visible => !visible)}
                aria-expanded={showFirstLoginHelp}
                aria-controls={firstLoginHelpId}
                className={`font-medium ${HELP_ACTION_CLASS}`}
              >
                Primer ingreso
              </button>
            </>
          ) : (
            <button
              type="button"
              disabled={locked}
              onClick={() => changeMode('login')}
              className={`font-medium ${HELP_ACTION_CLASS}`}
            >
              Volver al ingreso
            </button>
          )}
          {mode === 'reset' && (
            <button
              type="button"
              disabled={locked}
              onClick={() => changeMode('request')}
              className={`font-medium ${HELP_ACTION_CLASS}`}
            >
              Solicitar otro código
            </button>
          )}
        </div>
        {mode === 'login' && showFirstLoginHelp && (
          <div
            id={firstLoginHelpId}
            className="rounded-xl border border-teal-100 bg-teal-50 p-3 text-xs leading-5 text-teal-950"
          >
            <p>
              Si es tu primera vez, ingresa con tu RUT como usuario y usa los números del RUT, sin
              dígito verificador, como clave inicial.
            </p>
            <button
              type="button"
              disabled={locked}
              onClick={() => changeMode('activation')}
              className={`mt-2 font-semibold ${HELP_ACTION_CLASS}`}
            >
              Tengo un código de activación
            </button>
          </div>
        )}
      </form>
      {busy && (
        <div
          role="status"
          aria-live="polite"
          aria-atomic="true"
          className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-4 rounded-xl border border-teal-200 bg-white/95 px-5 text-center shadow-sm backdrop-blur-sm"
        >
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-teal-800/10 text-teal-800">
            <Loader2 className="h-6 w-6 motion-safe:animate-spin" aria-hidden="true" />
          </span>
          <div>
            <p className="text-base font-semibold text-teal-950">
              {mode === 'request' ? 'Enviando código de recuperación…' : 'Validando tu acceso…'}
            </p>
            <p className="mt-1 text-xs leading-5 text-teal-900">
              {mode === 'request'
                ? 'Espera un momento mientras enviamos tu solicitud.'
                : 'Comprobando tu acceso. Un momento, por favor.'}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
