import { useEffect, useRef, useState } from 'react';
import type { AuthContextType } from '@/context/AuthContext';
import { canConnectNursingHandoff } from '@/shared/access/operationalAccessPolicy';
import { defaultAuthRuntime } from '@/services/firebase-runtime/authRuntime';

const resultType = 'HHR_NURSING_HANDOFF_LINK_RESULT';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const validChallenge = /^[a-f0-9]{64}$/;

export interface HandoffConnectionRequest {
  requestId: string;
  deviceId: string;
  challenge: string;
  registerDevice: boolean;
}

export function readHandoffConnection(request: unknown): HandoffConnectionRequest | null {
  if (!request || typeof request !== 'object') return null;
  const { requestId, deviceId, challenge, registerDevice } = request as Record<string, unknown>;
  return typeof requestId === 'string' &&
    uuid.test(requestId) &&
    typeof deviceId === 'string' &&
    uuid.test(deviceId) &&
    typeof challenge === 'string' &&
    validChallenge.test(challenge)
    ? { requestId, deviceId, challenge, registerDevice: registerDevice === '1' }
    : null;
}

function readConnectionFragment() {
  return readHandoffConnection(
    Object.fromEntries(new URLSearchParams(window.location.hash.slice(1)))
  );
}

export function HandoffExtensionConnection({ auth }: { auth: AuthContextType }) {
  const [request, setRequest] = useState(() =>
    window.location.pathname === '/conectar-entrega-turno' ? readConnectionFragment() : null
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const dialog = useRef<HTMLDialogElement>(null);
  const user = auth.authorizedUser;
  const allowed = auth.isAuthorizedSession && canConnectNursingHandoff(auth.role);
  useEffect(() => {
    if (request && !dialog.current?.open) dialog.current?.showModal();
  }, [request]);
  if (!request) return null;

  const finish = (result?: { expiresAt: number } | { registered: true }) => {
    if (readConnectionFragment()?.requestId === request.requestId) {
      const { pathname, search } = window.location;
      window.history.replaceState(
        window.history.state,
        '',
        (pathname === '/conectar-entrega-turno' ? '/' : pathname) + search
      );
    }
    window.postMessage(
      { type: resultType, requestId: request.requestId, ...result },
      window.location.origin
    );
    setError('');
    setRequest(null);
  };
  const connect = async () => {
    if (!allowed || !user || busy) return;
    setBusy(true);
    setError('');
    try {
      await defaultAuthRuntime.ready;
      if (defaultAuthRuntime.getCurrentUser()?.uid !== user.uid) throw new Error('session changed');
      const { connectNursingHandoff, registerNursingHandoffDevice } =
        await import('@/services/handoff/nursingHandoffConnectionService');
      if (defaultAuthRuntime.getCurrentUser()?.uid !== user.uid) throw new Error('session changed');
      if (request.registerDevice) {
        await registerNursingHandoffDevice(request.deviceId, request.challenge);
        if (defaultAuthRuntime.getCurrentUser()?.uid !== user.uid)
          throw new Error('session changed');
        finish({ registered: true });
      } else {
        const expiresAt = await connectNursingHandoff(request.deviceId, request.challenge);
        if (
          defaultAuthRuntime.getCurrentUser()?.uid !== user.uid ||
          !Number.isFinite(expiresAt) ||
          expiresAt <= Date.now()
        )
          throw new Error('session changed');
        finish({ expiresAt });
      }
    } catch {
      setError(
        request.registerDevice
          ? 'No se pudo registrar el equipo. Comprueba que usas tu cuenta personal habilitada en HHR.'
          : 'No se pudo conectar. Comprueba tu sesión de HHR e inténtalo de nuevo.'
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <dialog
      ref={dialog}
      aria-labelledby="hhr-extension-handoff-title"
      className="m-auto w-[min(92vw,28rem)] rounded-xl bg-white p-6 text-slate-900 shadow-xl backdrop:bg-slate-900/40"
      onCancel={event => {
        event.preventDefault();
        if (!busy) finish();
      }}
    >
      <h1 id="hhr-extension-handoff-title" className="text-lg font-semibold">
        Entrega de turno desde Eloísa
      </h1>
      {allowed && user ? (
        <p className="mt-2 text-sm text-slate-600">
          {request.registerDevice
            ? 'Este equipo quedará registrado para '
            : 'Las entregas que guardes desde Eloísa quedarán a nombre de '}
          <strong>{user.displayName || user.email}</strong>.
        </p>
      ) : (
        <p className="mt-2 text-sm text-slate-600">
          Esta cuenta de HHR no tiene acceso a la entrega de enfermería.
        </p>
      )}
      {error && (
        <p role="alert" className="mt-3 text-sm text-red-700">
          {error}
        </p>
      )}
      <div className="mt-5 flex justify-end gap-2">
        <button
          type="button"
          className="rounded-md px-3 py-2 text-sm"
          disabled={busy}
          onClick={() => finish()}
        >
          Cancelar
        </button>
        {allowed && user && (
          <button
            type="button"
            className="rounded-md bg-teal-800 px-3 py-2 text-sm font-semibold text-white disabled:opacity-60"
            disabled={busy}
            onClick={() => void connect()}
          >
            {request.registerDevice
              ? busy
                ? 'Registrando…'
                : 'Registrar equipo'
              : busy
                ? 'Conectando…'
                : 'Conectar'}
          </button>
        )}
      </div>
    </dialog>
  );
}
