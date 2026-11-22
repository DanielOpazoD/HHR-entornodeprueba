/**
 * Page side of the Eloísa extension's silent Exalab reconnection. The extension answers only
 * booleans and outcomes; Exalab cookies travel from the extension straight to the bridge.
 */
export interface ExalabExtensionStatus {
  permission: boolean;
  autoConnect: boolean;
  session: boolean;
}
export type ExalabAutoConnectOutcome =
  | 'connected'
  | 'needs_consent'
  | 'no_session'
  | 'rejected'
  | 'network'
  | 'unavailable';
const OUTCOMES = new Set<ExalabAutoConnectOutcome>([
  'connected',
  'needs_consent',
  'no_session',
  'rejected',
  'network',
]);

/** Null when no extension answers (not installed, outdated or another browser). */
const askExtension = (
  type: string,
  signal: AbortSignal,
  extra: Record<string, unknown> = {},
  timeoutMs = 3000
): Promise<unknown> =>
  new Promise((resolve, reject) => {
    const reqId = crypto.randomUUID();
    const cleanup = () => {
      window.removeEventListener('message', listener);
      signal.removeEventListener('abort', abort);
      clearTimeout(timer);
    };
    const abort = () => {
      cleanup();
      reject(new DOMException('Conexión cancelada.', 'AbortError'));
    };
    const listener = (event: MessageEvent) => {
      if (
        event.source !== window ||
        event.origin !== window.location.origin ||
        event.data?.type !== `${type}_RESULT` ||
        event.data.reqId !== reqId
      )
        return;
      cleanup();
      resolve(event.data.result ?? null);
    };
    const timer = setTimeout(() => {
      cleanup();
      resolve(null);
    }, timeoutMs);
    if (signal.aborted) return abort();
    window.addEventListener('message', listener);
    signal.addEventListener('abort', abort, { once: true });
    window.postMessage({ type, reqId, ...extra }, window.location.origin);
  });

export const readExalabExtensionStatus = async (
  signal: AbortSignal
): Promise<ExalabExtensionStatus | null> => {
  const result = await askExtension('HHR_EXALAB_SESSION_STATUS', signal);
  if (!result || typeof result !== 'object') return null;
  const { permission, autoConnect, session } = result as Record<string, unknown>;
  return typeof permission === 'boolean' &&
    typeof autoConnect === 'boolean' &&
    typeof session === 'boolean'
    ? { permission, autoConnect, session }
    : null;
};

export const askExalabAutoConnect = async (
  pair: string,
  signal: AbortSignal
): Promise<ExalabAutoConnectOutcome> => {
  // The bridge checks the session against Exalab before answering, which can take a while.
  const result = await askExtension('HHR_EXALAB_AUTO_CONNECT', signal, { pair }, 60_000);
  const reason = (result as { reason?: unknown } | null)?.reason;
  return typeof reason === 'string' && OUTCOMES.has(reason as ExalabAutoConnectOutcome)
    ? (reason as ExalabAutoConnectOutcome)
    : 'unavailable';
};

/** Best effort: an extension that does not answer keeps nothing to forget. */
export const forgetExalabAutoConnect = (): void => {
  void askExtension('HHR_EXALAB_FORGET', new AbortController().signal).catch(() => undefined);
};

/** The extension announces (without values) that Exalab got a new session in this browser. */
export const onExalabSessionAvailable = (listener: () => void): (() => void) => {
  const handler = (event: MessageEvent) => {
    if (
      event.source === window &&
      event.origin === window.location.origin &&
      event.data?.type === 'HHR_EXALAB_SESSION_AVAILABLE'
    )
      listener();
  };
  window.addEventListener('message', handler);
  return () => window.removeEventListener('message', handler);
};
