/**
 * Read-only navigation bridge from an HHR patient row to the matching Ficha Médico encounter.
 * The browser extension owns tab navigation; HHR only sends the already-synced encounter id and
 * receives a small operational result. No clinical payload is returned or persisted.
 */

export const RAYEN_OPEN_ENCOUNTER_REQUEST_TYPE = 'HHR_RAYEN_OPEN_ENCOUNTER_REQUEST';
export const RAYEN_OPEN_ENCOUNTER_RESULT_TYPE = 'HHR_RAYEN_OPEN_ENCOUNTER_RESULT';

export interface RayenEncounterNavigationResult {
  ok: boolean;
  reused: boolean;
  error?: string;
}

export const requestRayenEncounterNavigation = (
  clinicalEpisodeId: string,
  timeoutMs = 8000
): Promise<RayenEncounterNavigationResult> =>
  new Promise(resolve => {
    const encounterId = clinicalEpisodeId.trim();
    if (typeof window === 'undefined' || !encounterId) {
      resolve({
        ok: false,
        reused: false,
        error: 'El paciente no tiene un episodio Eloísa válido.',
      });
      return;
    }

    const reqId = `open-encounter-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
    let settled = false;
    // eslint-disable-next-line prefer-const -- assigned once below, but read earlier by cleanup() (forward ref)
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
      if (!data || data.type !== RAYEN_OPEN_ENCOUNTER_RESULT_TYPE || data.reqId !== reqId) return;
      cleanup();
      resolve({
        ok: data.ok === true,
        reused: data.reused === true,
        error: typeof data.error === 'string' ? data.error : undefined,
      });
    };

    window.addEventListener('message', onMessage);
    window.postMessage(
      { type: RAYEN_OPEN_ENCOUNTER_REQUEST_TYPE, reqId, encId: encounterId },
      window.location.origin
    );

    timeoutId = setTimeout(() => {
      cleanup();
      resolve({
        ok: false,
        reused: false,
        error: 'La extensión Eloísa no respondió. Recárgala y vuelve a intentarlo.',
      });
    }, timeoutMs);
  });
