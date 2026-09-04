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
/** Dos latidos perdidos más un margen breve: el último verde deja de ser confiable. */
export const RAYEN_EXTENSION_HEALTH_LEASE_MS = 150_000;

const CHECKING_STATE: RayenExtensionHealthState = {
  connection: 'checking',
  report: null,
  message: 'Comprobando conexión…',
  canSync: false,
};

export const expireRayenExtensionHealthState = (
  previous: RayenExtensionHealthState,
  now = Date.now()
): RayenExtensionHealthState => {
  const report = previous.report;
  if (!report) return previous;
  const checkedAt = Date.parse(report.checkedAt);
  if (Number.isFinite(checkedAt) && now - checkedAt < RAYEN_EXTENSION_HEALTH_LEASE_MS) {
    return previous;
  }
  const staleMessage =
    'La señal de la extensión Eloísa dejó de actualizarse. Comprueba la extensión y las pestañas abiertas.';
  return {
    connection: 'offline',
    report: {
      ...report,
      fichaMedico: { ...report.fichaMedico, status: 'stale', message: staleMessage },
      gestionCamas: { ...report.gestionCamas, status: 'stale', message: staleMessage },
    },
    message: staleMessage,
    canSync: false,
  };
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
    let refreshTimer: number | null = null;
    void requestRayenExtensionHealth().then(result => {
      if (active && sequence === requestSequence.current) {
        setHealth(deriveHealthState(result.report, result.error));
      }
    });
    const scheduleRefresh = (): void => {
      if (refreshTimer !== null) window.clearTimeout(refreshTimer);
      refreshTimer = window.setTimeout(() => {
        refreshTimer = null;
        void refresh();
      }, 100);
    };
    const onFocus = (): void => {
      scheduleRefresh();
    };
    const onVisibilityChange = (): void => {
      if (!document.hidden) scheduleRefresh();
    };
    const onOnline = (): void => {
      scheduleRefresh();
    };
    window.addEventListener('focus', onFocus);
    window.addEventListener('online', onOnline);
    document.addEventListener('visibilitychange', onVisibilityChange);
    // La extensión empuja el estado sola (latido + transiciones de sesión):
    // un push fresco manda sobre cualquier chequeo en vuelo más antiguo.
    const unsubscribePush = subscribeToRayenExtensionHealthPush(report => {
      requestSequence.current += 1;
      setHealth(deriveHealthState(report));
    });
    return () => {
      active = false;
      requestSequence.current += 1;
      if (refreshTimer !== null) window.clearTimeout(refreshTimer);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('online', onOnline);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      unsubscribePush();
    };
  }, [refresh]);

  useEffect(() => {
    const checkedAtText = health.report?.checkedAt;
    if (!checkedAtText) return undefined;
    const checkedAt = Date.parse(checkedAtText);
    const delay = Number.isFinite(checkedAt)
      ? Math.max(0, checkedAt + RAYEN_EXTENSION_HEALTH_LEASE_MS - Date.now())
      : 0;
    const timer = window.setTimeout(() => {
      setHealth(previous =>
        previous.report?.checkedAt === checkedAtText
          ? expireRayenExtensionHealthState(previous)
          : previous
      );
    }, delay + 10);
    return () => window.clearTimeout(timer);
  }, [health.report?.checkedAt]);

  return { ...health, refresh };
};

export { deriveHealthState };
