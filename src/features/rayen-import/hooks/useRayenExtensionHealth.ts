import { useCallback, useEffect, useRef, useState } from 'react';
import {
  RAYEN_EXTENSION_PROTOCOL_VERSION,
  requestRayenExtensionHealth,
  type RayenExtensionHealthReport,
} from '../bridge/extensionHealthBridge';

export type RayenExtensionConnectionState =
  | 'checking'
  | 'ready'
  | 'degraded'
  | 'blocked'
  | 'offline'
  | 'incompatible';

export interface RayenExtensionHealthState {
  connection: RayenExtensionConnectionState;
  report: RayenExtensionHealthReport | null;
  message: string;
  canSync: boolean;
}

export interface RayenExtensionHealthRefreshOptions {
  timeoutMs?: number;
}

const CHECKING_STATE: RayenExtensionHealthState = {
  connection: 'checking',
  report: null,
  message: 'Comprobando conexión…',
  canSync: false,
};

const deriveHealthState = (
  report: RayenExtensionHealthReport | null,
  error?: string
): RayenExtensionHealthState => {
  if (!report) {
    return {
      connection: 'offline',
      report: null,
      message: error ?? 'La extensión Eloísa no está disponible.',
      canSync: false,
    };
  }

  if (report.protocolVersion !== RAYEN_EXTENSION_PROTOCOL_VERSION) {
    return {
      connection: 'incompatible',
      report,
      message: `Extensión v${report.version} incompatible. Recarga la versión incluida en el proyecto.`,
      canSync: false,
    };
  }

  if (report.fichaMedico.status !== 'ready') {
    return {
      connection: 'blocked',
      report,
      message: report.fichaMedico.message,
      canSync: false,
    };
  }

  if (report.gestionCamas.status !== 'ready') {
    return {
      connection: 'blocked',
      report,
      message: `${report.gestionCamas.message} Se requieren Ficha Médico y Gestión de Camas para sincronizar.`,
      canSync: false,
    };
  }

  return {
    connection: 'ready',
    report,
    message: `Extensión Eloísa v${report.version} operativa.`,
    canSync: true,
  };
};

export const useRayenExtensionHealth = () => {
  const [health, setHealth] = useState<RayenExtensionHealthState>(CHECKING_STATE);
  const requestSequence = useRef(0);

  const refresh = useCallback(
    async (
      options: RayenExtensionHealthRefreshOptions = {}
    ): Promise<RayenExtensionHealthState> => {
      const sequence = ++requestSequence.current;
      setHealth(previous => ({
        ...previous,
        connection: 'checking',
        message: 'Comprobando conexión…',
      }));
      const result = await requestRayenExtensionHealth(options.timeoutMs);
      const next = deriveHealthState(result.report, result.error);
      if (sequence === requestSequence.current) setHealth(next);
      return next;
    },
    []
  );

  useEffect(() => {
    const sequence = ++requestSequence.current;
    let active = true;
    void requestRayenExtensionHealth().then(result => {
      if (active && sequence === requestSequence.current) {
        setHealth(deriveHealthState(result.report, result.error));
      }
    });
    const onFocus = (): void => {
      void refresh();
    };
    window.addEventListener('focus', onFocus);
    return () => {
      active = false;
      requestSequence.current += 1;
      window.removeEventListener('focus', onFocus);
    };
  }, [refresh]);

  return { ...health, refresh };
};

export { deriveHealthState };
