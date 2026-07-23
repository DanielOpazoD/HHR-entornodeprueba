import { useCallback, useEffect, useState } from 'react';
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

  const refresh = useCallback(async () => {
    const status = await requestSyslabExtensionStatus();
    if (!status.bridgeAvailable) {
      setState('unavailable');
      setMessage(status.message);
      setIsAwaitingLogin(false);
      return;
    }
    if (status.connected) {
      setState('connected');
      setMessage(status.message);
      setIsAwaitingLogin(false);
      return;
    }
    setState(status.loginRequired ? 'login-required' : 'unavailable');
    setMessage(status.message);
    if (!status.loginRequired) setIsAwaitingLogin(false);
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    const timeout = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(timeout);
  }, [isOpen, refresh]);

  useEffect(() => {
    if (!isOpen || !isAwaitingLogin) return;
    const interval = window.setInterval(() => void refresh(), STATUS_POLL_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, [isAwaitingLogin, isOpen, refresh]);

  const openLogin = useCallback(async () => {
    setIsOpening(true);
    const result = await openSyslabLoginWindow();
    setIsOpening(false);
    if (!result.bridgeAvailable || !result.opened || result.error) {
      setState('login-required');
      setMessage(result.error || 'No se pudo abrir el acceso a Syslab.');
      return;
    }
    setIsAwaitingLogin(true);
    setMessage(
      'Completa el acceso en la ventana de la extensión. Esta pantalla se actualizará automáticamente.'
    );
  }, []);

  return { state, message, isOpening, isAwaitingLogin, refresh, openLogin };
};
