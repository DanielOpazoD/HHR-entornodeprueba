import { useCallback, useEffect, useRef, useState } from 'react';
import {
  openSyslabLoginWindow,
  requestSyslabExtensionStatus,
} from '@/services/laboratory/syslabExtensionBridge';

type SyslabAccessState = 'checking' | 'connected' | 'login-required' | 'unavailable';

export interface SyslabAccessModel {
  state: SyslabAccessState;
  message: string;
  isOpening: boolean;
  isAwaitingLogin: boolean;
  refresh: () => Promise<void>;
  openLogin: () => Promise<void>;
}

const STATUS_POLL_INTERVAL_MS = 2_000;

export const useSyslabAccess = (isOpen: boolean): SyslabAccessModel => {
  const [state, setState] = useState<SyslabAccessState>('checking');
  const [message, setMessage] = useState('Comprobando la sesión de Syslab…');
  const [isOpening, setIsOpening] = useState(false);
  const [isAwaitingLogin, setIsAwaitingLogin] = useState(false);

  const sessionRef = useRef<{
    active: boolean;
    pending: Promise<void> | null;
    opening: boolean;
  }>({ active: false, pending: null, opening: false });

  const refresh = useCallback((): Promise<void> => {
    const session = sessionRef.current;
    if (!session.active) return Promise.resolve();
    if (session.pending) return session.pending;
    session.pending = (async () => {
      try {
        const status = await requestSyslabExtensionStatus();
        if (!session.active) return;
        const nextState = !status.bridgeAvailable
          ? 'unavailable'
          : status.connected
            ? 'connected'
            : status.loginRequired
              ? 'login-required'
              : 'unavailable';
        setState(nextState);
        setMessage(status.message);
        if (nextState !== 'login-required') setIsAwaitingLogin(false);
      } catch {
        if (!session.active) return;
        setState('unavailable');
        setMessage('No se pudo comprobar la sesión de Syslab. Reintenta.');
        setIsAwaitingLogin(false);
      } finally {
        session.pending = null;
      }
    })();
    return session.pending;
  }, []);

  useEffect(() => {
    const session = { active: isOpen, pending: null, opening: false };
    sessionRef.current = session;
    if (!isOpen) return;
    const timeout = window.setTimeout(() => {
      setState('checking');
      setIsOpening(false);
      setIsAwaitingLogin(false);
      void refresh();
    }, 0);
    return () => {
      session.active = false;
      window.clearTimeout(timeout);
    };
  }, [isOpen, refresh]);

  useEffect(() => {
    if (!isOpen || !isAwaitingLogin) return;
    const interval = window.setInterval(() => void refresh(), STATUS_POLL_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, [isAwaitingLogin, isOpen, refresh]);

  const openLogin = useCallback(async () => {
    const session = sessionRef.current;
    if (!session.active || session.opening) return;
    session.opening = true;
    setIsOpening(true);
    try {
      const result = await openSyslabLoginWindow();
      if (!session.active) return;
      if (!result.bridgeAvailable || !result.opened || result.error) {
        setState('login-required');
        setMessage(result.error || 'No se pudo abrir el acceso a Syslab.');
        return;
      }
      setIsAwaitingLogin(true);
      setMessage(
        'Completa el acceso en la ventana de la extensión. Esta pantalla se actualizará automáticamente.'
      );
    } catch {
      if (!session.active) return;
      setState('login-required');
      setMessage('No se pudo abrir el acceso a Syslab.');
    } finally {
      session.opening = false;
      if (session.active) setIsOpening(false);
    }
  }, []);

  return { state, message, isOpening, isAwaitingLogin, refresh, openLogin };
};
