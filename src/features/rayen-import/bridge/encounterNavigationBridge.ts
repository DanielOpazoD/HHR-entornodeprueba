import { requestViaBridgeChannel } from '@/services/transport/extensionRequestChannel';

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
  timeoutMs = 8000,
  routeHint?: 'medical' | 'nurse'
): Promise<RayenEncounterNavigationResult> => {
  const encounterId = clinicalEpisodeId.trim();
  if (typeof window === 'undefined' || !encounterId) {
    return Promise.resolve({
      ok: false,
      reused: false,
      error: 'El paciente no tiene un episodio Eloísa válido.',
    });
  }

  return requestViaBridgeChannel<RayenEncounterNavigationResult>({
    prefix: 'open-encounter',
    requestType: RAYEN_OPEN_ENCOUNTER_REQUEST_TYPE,
    resultType: RAYEN_OPEN_ENCOUNTER_RESULT_TYPE,
    payload: { encId: encounterId, routeHint },
    timeoutMs,
    onTimeout: () => ({
      ok: false,
      reused: false,
      error: 'La extensión Eloísa no respondió. Recárgala y vuelve a intentarlo.',
    }),
    mapResult: data => ({
      ok: data.ok === true,
      reused: data.reused === true,
      error: typeof data.error === 'string' ? data.error : undefined,
    }),
  });
};
