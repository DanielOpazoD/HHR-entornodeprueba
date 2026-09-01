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
): Promise<RayenGestionCamasConnectResult> =>
  new Promise(resolve => {
    if (typeof window === 'undefined') {
      resolve({ ok: false, error: 'La conexión requiere el navegador.' });
      return;
    }
    const reqId = `gc-connect-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
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
      const data = event.data as {
        type?: unknown;
        reqId?: unknown;
        ok?: unknown;
        error?: unknown;
      } | null;
      if (!data || data.type !== RAYEN_GC_CONNECT_RESULT_TYPE || data.reqId !== reqId) return;
      cleanup();
      resolve({
        ok: data.ok === true,
        ...(typeof data.error === 'string' && data.error ? { error: data.error } : {}),
      });
    };

    window.addEventListener('message', onMessage);
    window.postMessage(
      { type: RAYEN_GC_CONNECT_REQUEST_TYPE, reqId, renew: options.renew === true },
      window.location.origin
    );

    timeoutId = setTimeout(() => {
      cleanup();
      resolve({
        ok: false,
        error: 'La extensión no respondió al abrir Gestión de Camas. Vuelve a comprobar.',
      });
    }, timeoutMs);
  });
