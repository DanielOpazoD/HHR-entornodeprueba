/**
 * Ciclo de vida compartido de los canales request/response del bridge hacia la
 * extensión: correlación por `reqId`, un único listener que se retira al
 * resolver, timer de timeout siempre cancelado (sin fugas) y degradación
 * explícita cuando la extensión no responde. Los seis canales de lectura de
 * `rayenImportBridge` difieren sólo en su payload y en cómo mapean la
 * respuesta.
 */
export const requestViaBridgeChannel = <T>({
  prefix,
  requestType,
  resultType,
  payload,
  timeoutMs,
  onTimeout,
  mapResult,
}: {
  prefix: string;
  requestType: string;
  resultType: string;
  payload: Record<string, unknown>;
  timeoutMs: number;
  onTimeout: () => T;
  mapResult: (data: Record<string, unknown>) => T;
}): Promise<T> =>
  new Promise(resolve => {
    const reqId = `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
    let settled = false;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    const cleanup = (): void => {
      if (settled) return;
      settled = true;
      window.removeEventListener('message', onMessage);
      if (timeoutId) clearTimeout(timeoutId);
    };

    const onMessage = (event: MessageEvent): void => {
      if (event.origin !== window.location.origin) return;
      const data = event.data as Record<string, unknown> | null;
      if (!data || data.type !== resultType || data.reqId !== reqId) return;
      cleanup();
      resolve(mapResult(data));
    };

    window.addEventListener('message', onMessage);
    window.postMessage({ type: requestType, reqId, ...payload }, window.location.origin);
    timeoutId = setTimeout(() => {
      cleanup();
      resolve(onTimeout());
    }, timeoutMs);
  });
