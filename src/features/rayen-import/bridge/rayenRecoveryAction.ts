import {
  RAYEN_HHR_CONNECTION_REPAIR_BRIDGE_CAPABILITY,
  type RayenExtensionHealthReport,
  type RayenSourceHealth,
} from './extensionHealthBridge';
import type { RayenExtensionConnectionState } from '../hooks/useRayenExtensionHealth';

export type RayenRecoveryActionKind = 'none' | 'refresh' | 'connect-gc' | 'repair';

export interface RayenRecoveryAction {
  kind: RayenRecoveryActionKind;
  label?: string;
  renewGestionCamas?: boolean;
}

const hasReason = (source: RayenSourceHealth | undefined, reasons: string[]): boolean =>
  Boolean(source?.reason && reasons.includes(source.reason));

export const deriveRayenRecoveryAction = ({
  connection,
  report,
  working,
}: {
  connection: RayenExtensionConnectionState;
  report: RayenExtensionHealthReport | null;
  working: boolean;
}): RayenRecoveryAction => {
  if (working || connection === 'checking') return { kind: 'none' };
  if (connection === 'incompatible') return { kind: 'none' };
  if (!report) return { kind: 'refresh', label: 'Reintentar comprobación' };

  const ficha = report.fichaMedico;
  const camas = report.gestionCamas;
  const fichaReady = ficha.status === 'ready';
  const camasReady = camas.status === 'ready';
  const fichaExpiring =
    ficha.expiring === true || (ficha.remainingSeconds ?? Number.POSITIVE_INFINITY) < 240;
  const supportsRepair =
    report.capabilities?.includes(RAYEN_HHR_CONNECTION_REPAIR_BRIDGE_CAPABILITY) === true;

  if (fichaReady && fichaExpiring && supportsRepair) {
    return { kind: 'repair', label: 'Abrir conexión limpia' };
  }

  // Si Ficha Médico sigue vigente y el único problema es la sesión de Camas,
  // la apertura dirigida evita crear una segunda pestaña clínica innecesaria.
  if (fichaReady && !camasReady && !hasReason(camas, ['outdated_tab', 'relay_disconnected'])) {
    const renewGestionCamas =
      camas.reason === 'session_expired' || camas.connectionSource === 'session';
    return {
      kind: 'connect-gc',
      label:
        camas.reason === 'session_expired'
          ? 'Iniciar sesión en Gestión de Camas'
          : renewGestionCamas
            ? 'Renovar Gestión de Camas'
            : 'Abrir Gestión de Camas',
      renewGestionCamas,
    };
  }

  if (
    fichaReady &&
    camasReady &&
    (camas.expiring === true || (camas.remainingSeconds ?? Number.POSITIVE_INFINITY) < 240)
  ) {
    return { kind: 'connect-gc', label: 'Renovar Gestión de Camas', renewGestionCamas: true };
  }
  if (supportsRepair) {
    const sources = [ficha, camas];
    if (sources.some(source => hasReason(source, ['session_expired']))) {
      return { kind: 'repair', label: 'Iniciar sesión en pestañas nuevas' };
    }
    if (sources.some(source => hasReason(source, ['outdated_tab']))) {
      return { kind: 'repair', label: 'Abrir conexión limpia' };
    }
    if (sources.some(source => hasReason(source, ['relay_disconnected']))) {
      return { kind: 'repair', label: 'Restablecer enlaces' };
    }
    if (!fichaReady || !camasReady) {
      return { kind: 'repair', label: 'Abrir pestañas necesarias' };
    }
  }

  if (connection === 'ready') return { kind: 'none' };
  return { kind: 'refresh', label: 'Reintentar comprobación' };
};
