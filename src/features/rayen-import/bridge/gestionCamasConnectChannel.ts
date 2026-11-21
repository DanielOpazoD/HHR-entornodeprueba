import { requestViaBridgeChannel } from '@/services/transport/extensionRequestChannel';

/**
 * Abre la ventana oficial de conexión de Gestión de Camas directamente desde
 * HHR, sin viajar a la pestaña de Eloísa: página → content-hhr → background
 * (`RAYEN_GC_CONNECT_REQUEST`, ruta ya existente). La contraseña se ingresa
 * únicamente en la página oficial de Rayen; aquí solo se pide abrirla. El
 * resultado de la conexión llega solo por el push de salud (`gc-captured`).
 */

export const RAYEN_GC_CONNECT_REQUEST_TYPE = 'HHR_RAYEN_GC_CONNECT_REQUEST';
export const RAYEN_GC_CONNECT_RESULT_TYPE = 'HHR_RAYEN_GC_CONNECT_RESULT';
export const RAYEN_GC_CONNECT_TIMEOUT_MS = 15_000;

export interface RayenGestionCamasConnectResult {
  ok: boolean;
  error?: string;
}

export const requestGestionCamasConnect = (
  options: { renew?: boolean } = {},
  timeoutMs = RAYEN_GC_CONNECT_TIMEOUT_MS
): Promise<RayenGestionCamasConnectResult> => {
  if (typeof window === 'undefined') {
    return Promise.resolve({ ok: false, error: 'La conexión requiere el navegador.' });
  }
  return requestViaBridgeChannel<RayenGestionCamasConnectResult>({
    prefix: 'gc-connect',
    requestType: RAYEN_GC_CONNECT_REQUEST_TYPE,
    resultType: RAYEN_GC_CONNECT_RESULT_TYPE,
    payload: { renew: options.renew === true },
    timeoutMs,
    onTimeout: () => ({
      ok: false,
      error: 'La extensión no respondió al abrir Gestión de Camas. Vuelve a comprobar.',
    }),
    mapResult: data => ({
      ok: data.ok === true,
      ...(typeof data.error === 'string' && data.error ? { error: data.error } : {}),
    }),
  });
};
