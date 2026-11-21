/**
 * Ciclo de vida compartido de los canales request/response del bridge hacia la
 * extensión: correlación por `reqId`, verificación de mismo origen y ventana,
 * un único listener que se retira al resolver, timer de timeout siempre
 * cancelado (sin fugas) y degradación explícita ante timeout, cancelación o
 * error de envío.
 */
export const requestViaBridgeChannel = <T>({
  prefix,
  requestType,
  resultType,
  payload,
  timeoutMs,
  onTimeout,
  mapResult,
  signal,
  onAbort,
  onDispatchError,
}: {
  prefix: string;
  requestType: string;
  resultType: string;
  payload: Record<string, unknown>;
  timeoutMs: number;
  onTimeout: () => T;
  mapResult: (data: Record<string, unknown>) => T;
  signal?: AbortSignal;
  onAbort?: () => T;
  onDispatchError?: (error: unknown) => T;
}): Promise<T> =>
  new Promise((resolve, reject) => {
    const reqId = `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
    let settled = false;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    const cleanup = (): void => {
      if (settled) return;
      settled = true;
      window.removeEventListener('message', onMessage);
      signal?.removeEventListener('abort', handleAbort);
      if (timeoutId) clearTimeout(timeoutId);
    };

    const finish = (read: () => T): void => {
      if (settled) return;
      cleanup();
      try {
        resolve(read());
      } catch (error) {
        reject(error);
      }
    };

    const handleAbort = (): void => {
      if (settled) return;
      if (onAbort) {
        finish(onAbort);
        return;
      }
      cleanup();
      reject(signal?.reason ?? new DOMException('Clinical read cancelled', 'AbortError'));
    };

    const onMessage = (event: MessageEvent): void => {
      if (event.source !== window || event.origin !== window.location.origin) return;
      const data = event.data as Record<string, unknown> | null;
      if (!data || typeof data !== 'object' || data.type !== resultType || data.reqId !== reqId)
        return;
      finish(() => mapResult(data));
    };

    if (signal?.aborted) {
      handleAbort();
      return;
    }
    window.addEventListener('message', onMessage);
    signal?.addEventListener('abort', handleAbort, { once: true });
    timeoutId = setTimeout(() => finish(onTimeout), timeoutMs);
    try {
      window.postMessage({ type: requestType, reqId, ...payload }, window.location.origin);
    } catch (error) {
      if (onDispatchError) {
        finish(() => onDispatchError(error));
        return;
      }
      cleanup();
      reject(error);
    }
  });
