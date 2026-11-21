import { requestViaBridgeChannel } from '@/services/transport/extensionRequestChannel';
import {
  isRayenExtensionHealthReport,
  type RayenExtensionHealthReport,
} from './extensionHealthBridge';

export const RAYEN_CONNECTION_REPAIR_REQUEST_TYPE = 'HHR_RAYEN_CONNECTION_REPAIR_REQUEST';
export const RAYEN_CONNECTION_REPAIR_RESULT_TYPE = 'HHR_RAYEN_CONNECTION_REPAIR_RESULT';
export const RAYEN_CONNECTION_REPAIR_TIMEOUT_MS = 75_000;

export interface RayenConnectionRepairResult {
  ok: boolean;
  state?: string;
  message?: string;
  error?: string;
  requiresLogin?: boolean;
  report?: RayenExtensionHealthReport;
}

/**
 * Solicita al service worker la reparación limpia ya existente. La página HHR
 * no abre ni recarga pestañas por su cuenta: content-hhr mantiene ese límite de
 * confianza y solo devuelve un resultado correlacionado por reqId.
 */
export const requestRayenConnectionRepair = (
  timeoutMs = RAYEN_CONNECTION_REPAIR_TIMEOUT_MS
): Promise<RayenConnectionRepairResult> => {
  if (typeof window === 'undefined') {
    return Promise.resolve({ ok: false, error: 'La reparación requiere el navegador.' });
  }
  return requestViaBridgeChannel<RayenConnectionRepairResult>({
    prefix: 'connection-repair',
    requestType: RAYEN_CONNECTION_REPAIR_REQUEST_TYPE,
    resultType: RAYEN_CONNECTION_REPAIR_RESULT_TYPE,
    payload: {},
    timeoutMs,
    onTimeout: () => ({
      ok: false,
      error: 'La extensión no terminó de reparar la conexión. Revisa las pestañas nuevas.',
    }),
    mapResult: data => ({
      ok: data.ok === true,
      ...(typeof data.state === 'string' ? { state: data.state } : {}),
      ...(typeof data.message === 'string' ? { message: data.message } : {}),
      ...(typeof data.error === 'string' ? { error: data.error } : {}),
      ...(data.requiresLogin === true ? { requiresLogin: true } : {}),
      ...(isRayenExtensionHealthReport(data.report) ? { report: data.report } : {}),
    }),
  });
};
