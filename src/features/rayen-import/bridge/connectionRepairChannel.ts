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
): Promise<RayenConnectionRepairResult> =>
  new Promise(resolve => {
    if (typeof window === 'undefined') {
      resolve({ ok: false, error: 'La reparación requiere el navegador.' });
      return;
    }

    const reqId = `connection-repair-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
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
      const data = event.data as Record<string, unknown> | null;
      if (!data || data.type !== RAYEN_CONNECTION_REPAIR_RESULT_TYPE || data.reqId !== reqId) {
        return;
      }
      cleanup();
      resolve({
        ok: data.ok === true,
        ...(typeof data.state === 'string' ? { state: data.state } : {}),
        ...(typeof data.message === 'string' ? { message: data.message } : {}),
        ...(typeof data.error === 'string' ? { error: data.error } : {}),
        ...(data.requiresLogin === true ? { requiresLogin: true } : {}),
        ...(isRayenExtensionHealthReport(data.report) ? { report: data.report } : {}),
      });
    };

    window.addEventListener('message', onMessage);
    window.postMessage(
      { type: RAYEN_CONNECTION_REPAIR_REQUEST_TYPE, reqId },
      window.location.origin
    );

    timeoutId = setTimeout(() => {
      cleanup();
      resolve({
        ok: false,
        error: 'La extensión no terminó de reparar la conexión. Revisa las pestañas nuevas.',
      });
    }, timeoutMs);
  });
