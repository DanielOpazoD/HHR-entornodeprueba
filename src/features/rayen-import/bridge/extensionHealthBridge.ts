/**
 * Lightweight capability handshake between HHR and the Eloísa browser extension.
 *
 * The check never reads clinical payloads or authentication tokens. It only confirms that the
 * extension version/protocol is compatible and that the relay content scripts answer in the
 * currently open Ficha Médico and Gestión de Camas tabs.
 */

export const RAYEN_EXTENSION_HEALTH_REQUEST_TYPE = 'HHR_RAYEN_EXTENSION_HEALTH_REQUEST';
export const RAYEN_EXTENSION_HEALTH_RESULT_TYPE = 'HHR_RAYEN_EXTENSION_HEALTH_RESULT';
export const RAYEN_EXTENSION_PASSIVE_HEALTH_TIMEOUT_MS = 2_500;
export const RAYEN_EXTENSION_SYNC_HEALTH_TIMEOUT_MS = 12_000;
export const RAYEN_EXTENSION_PROTOCOL_VERSION = 5;
export const RAYEN_PATIENT_FLOW_CAPABILITY = 'patient-flow-report';
export const RAYEN_STATISTICAL_DISCHARGE_EVIDENCE_CAPABILITY = 'statistical-discharge-evidence';

export type RayenSourceAvailability = 'ready' | 'missing' | 'stale';

export interface RayenSourceHealth {
  status: RayenSourceAvailability;
  message: string;
  /** Segundos de vigencia restantes del token temporal (solo Gestión de Camas). */
  remainingSeconds?: number | null;
  /** La extensión marca la sesión como próxima a vencer (ventana de 10 min). */
  expiring?: boolean;
}

export interface RayenExtensionHealthReport {
  version: string;
  protocolVersion: number;
  capabilities?: string[];
  checkedAt: string;
  fichaMedico: RayenSourceHealth;
  gestionCamas: RayenSourceHealth;
}

export interface RayenExtensionHealthCheck {
  report: RayenExtensionHealthReport | null;
  error?: string;
}

const isSourceHealth = (value: unknown): value is RayenSourceHealth => {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    (candidate.status === 'ready' ||
      candidate.status === 'missing' ||
      candidate.status === 'stale') &&
    typeof candidate.message === 'string' &&
    (candidate.remainingSeconds === undefined ||
      candidate.remainingSeconds === null ||
      typeof candidate.remainingSeconds === 'number') &&
    (candidate.expiring === undefined || typeof candidate.expiring === 'boolean')
  );
};

export const isRayenExtensionHealthReport = (
  value: unknown
): value is RayenExtensionHealthReport => {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.version === 'string' &&
    typeof candidate.protocolVersion === 'number' &&
    (candidate.capabilities === undefined ||
      (Array.isArray(candidate.capabilities) &&
        candidate.capabilities.every(capability => typeof capability === 'string'))) &&
    typeof candidate.checkedAt === 'string' &&
    isSourceHealth(candidate.fichaMedico) &&
    isSourceHealth(candidate.gestionCamas)
  );
};

export const supportsPatientFlowReport = (report: RayenExtensionHealthReport | null): boolean =>
  report?.capabilities?.includes(RAYEN_PATIENT_FLOW_CAPABILITY) === true;

export const supportsStatisticalDischargeEvidence = (
  report: RayenExtensionHealthReport | null
): boolean =>
  report?.capabilities?.includes(RAYEN_STATISTICAL_DISCHARGE_EVIDENCE_CAPABILITY) === true;

export const requestRayenExtensionHealth = (
  timeoutMs = RAYEN_EXTENSION_PASSIVE_HEALTH_TIMEOUT_MS
): Promise<RayenExtensionHealthCheck> =>
  new Promise(resolve => {
    if (typeof window === 'undefined') {
      resolve({ report: null, error: 'El diagnóstico Eloísa requiere el navegador.' });
      return;
    }

    const reqId = `health-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
    let settled = false;
    // eslint-disable-next-line prefer-const -- assigned after listener setup, read by cleanup first
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    const cleanup = (): void => {
      if (settled) return;
      settled = true;
      if (timeoutId !== undefined) clearTimeout(timeoutId);
      window.removeEventListener('message', onMessage);
    };

    const onMessage = (event: MessageEvent): void => {
      if (event.origin !== window.location.origin) return;
      const data = event.data;
      if (!data || data.type !== RAYEN_EXTENSION_HEALTH_RESULT_TYPE || data.reqId !== reqId) {
        return;
      }
      cleanup();
      if (isRayenExtensionHealthReport(data.report)) {
        resolve({ report: data.report });
        return;
      }
      resolve({
        report: null,
        error:
          typeof data.error === 'string'
            ? data.error
            : 'La extensión Eloísa respondió con un diagnóstico no reconocido.',
      });
    };

    window.addEventListener('message', onMessage);
    window.postMessage(
      { type: RAYEN_EXTENSION_HEALTH_REQUEST_TYPE, reqId },
      window.location.origin
    );

    timeoutId = setTimeout(() => {
      cleanup();
      resolve({
        report: null,
        error: 'La extensión Eloísa no respondió. Recárgala desde Chrome y vuelve a comprobar.',
      });
    }, timeoutMs);
  });
