import { useCallback, useEffect, useRef, useState } from 'react';
import {
  RAYEN_EXTENSION_PROTOCOL_VERSION,
  requestRayenExtensionHealth,
  subscribeToRayenExtensionHealthPush,
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
  /**
   * Quién bloquea cuando `connection === 'blocked'`. Sin esto, un bloqueo por
   * vigencia de Ficha Médico (fuente `ready`) se etiquetaba y auditaba como
   * Gestión de Camas (revisión de #306).
   */
  blockedBy?: 'fichaMedico' | 'gestionCamas';
}

export interface RayenExtensionHealthRefreshOptions {
  timeoutMs?: number;
}

/**
 * Una corrida usa Gestión de Camas al inicio (informe de egresos) y de nuevo
 * en la fase clínica (CUDYR/egresos), varios minutos después si el usuario se
 * detiene en la revisión. Si el token temporal vence antes, esos pacientes
 * quedaban con «fuente clínica incompleta» a mitad de corrida; mejor pedir la
 * renovación ANTES de partir.
 */
export const GESTION_CAMAS_MIN_REMAINING_SECONDS = 240;
export const FICHA_MEDICO_MIN_REMAINING_SECONDS = 240;

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
      blockedBy: 'fichaMedico',
      report,
      message: report.fichaMedico.message,
      canSync: false,
    };
  }

  // Vigencia de Ficha Médico (extensión ≥ 0.48.5; sesiones de 24 h que vencen a hora
  // fija, típicamente en plena mañana): mismo criterio que Gestión de Camas.
  const fichaMedicoRemainingSeconds = report.fichaMedico.remainingSeconds;
  if (
    typeof fichaMedicoRemainingSeconds === 'number' &&
    Number.isFinite(fichaMedicoRemainingSeconds) &&
    fichaMedicoRemainingSeconds < FICHA_MEDICO_MIN_REMAINING_SECONDS
  ) {
    const minutes = Math.max(1, Math.ceil(fichaMedicoRemainingSeconds / 60));
    return {
      connection: 'blocked',
      blockedBy: 'fichaMedico',
      report,
      message:
        fichaMedicoRemainingSeconds <= 0
          ? 'La sesión de Ficha Médico venció. Vuelve a iniciar sesión en Eloísa (Ficha Médico) y reintenta.'
          : `La sesión de Ficha Médico vence en ~${minutes} min y no alcanzaría a cubrir la ` +
            'sincronización. Vuelve a iniciar sesión en Eloísa (Ficha Médico) y reintenta.',
      canSync: false,
    };
  }

  if (report.gestionCamas.status !== 'ready') {
    return {
      connection: 'blocked',
      blockedBy: 'gestionCamas',
      report,
      message: `${report.gestionCamas.message} Se requieren Ficha Médico y Gestión de Camas para sincronizar.`,
      canSync: false,
    };
  }

  const gestionCamasRemainingSeconds = report.gestionCamas.remainingSeconds;
  if (
    typeof gestionCamasRemainingSeconds === 'number' &&
    Number.isFinite(gestionCamasRemainingSeconds) &&
    gestionCamasRemainingSeconds < GESTION_CAMAS_MIN_REMAINING_SECONDS
  ) {
    const minutes = Math.max(1, Math.ceil(gestionCamasRemainingSeconds / 60));
    return {
      connection: 'blocked',
      blockedBy: 'gestionCamas',
      report,
      message:
        gestionCamasRemainingSeconds <= 0
          ? 'La sesión de Gestión de Camas venció. Renuévala desde Conexiones en el Centro HHR de la pestaña de Eloísa y vuelve a intentar.'
          : `La sesión de Gestión de Camas vence en ~${minutes} min y no alcanzaría a cubrir la ` +
            'sincronización. Renuévala desde Conexiones en el Centro HHR de la pestaña de Eloísa y vuelve a intentar.',
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
    // La extensión empuja el estado sola (latido + transiciones de sesión):
    // un push fresco manda sobre cualquier chequeo en vuelo más antiguo.
    const unsubscribePush = subscribeToRayenExtensionHealthPush(report => {
      requestSequence.current += 1;
      setHealth(deriveHealthState(report));
    });
    return () => {
      active = false;
      requestSequence.current += 1;
      window.removeEventListener('focus', onFocus);
      unsubscribePush();
    };
  }, [refresh]);

  return { ...health, refresh };
};

export { deriveHealthState };
