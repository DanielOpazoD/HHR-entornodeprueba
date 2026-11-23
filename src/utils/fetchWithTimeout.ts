export interface FetchWithTimeoutOptions extends RequestInit {
  timeoutMs: number;
  timeoutMessage?: string;
}

/**
 * Wraps `fetch` with a bounded `AbortController` timeout and optional external `AbortSignal`
 * forwarding. Clears the timeout timer in all exit paths.
 */
export const fetchWithTimeout = async (
  input: RequestInfo | URL,
  { timeoutMs, timeoutMessage, signal: externalSignal, ...init }: FetchWithTimeoutOptions
): Promise<Response> => {
  if (typeof AbortController === 'undefined') {
    return fetch(input, { ...init, ...(externalSignal ? { signal: externalSignal } : {}) });
  }

  const controller = new AbortController();
  let timedOut = false;
  const onExternalAbort = () => controller.abort();

  if (externalSignal) {
    if (externalSignal.aborted) {
      controller.abort();
    } else {
      externalSignal.addEventListener('abort', onExternalAbort, { once: true });
    }
  }

  const timeoutId = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } catch (error) {
    if (timedOut && timeoutMessage) {
      throw new Error(timeoutMessage);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
    externalSignal?.removeEventListener('abort', onExternalAbort);
  }
};
