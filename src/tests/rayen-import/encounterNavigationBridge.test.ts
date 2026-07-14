import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  RAYEN_OPEN_ENCOUNTER_REQUEST_TYPE,
  RAYEN_OPEN_ENCOUNTER_RESULT_TYPE,
  requestRayenEncounterNavigation,
} from '@/features/rayen-import/bridge/encounterNavigationBridge';

describe('encounterNavigationBridge', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('correlates the extension result with the generated request id', async () => {
    const postMessageSpy = vi.spyOn(window, 'postMessage');
    const request = requestRayenEncounterNavigation('141336', 1000);
    const payload = postMessageSpy.mock.calls[0]?.[0] as {
      reqId: string;
      type: string;
      encId: string;
    };

    expect(payload).toMatchObject({
      type: RAYEN_OPEN_ENCOUNTER_REQUEST_TYPE,
      encId: '141336',
    });

    window.dispatchEvent(
      new MessageEvent('message', {
        origin: window.location.origin,
        data: {
          type: RAYEN_OPEN_ENCOUNTER_RESULT_TYPE,
          reqId: payload.reqId,
          ok: true,
          reused: true,
        },
      })
    );

    await expect(request).resolves.toEqual({ ok: true, reused: true, error: undefined });
  });

  it('returns an actionable timeout when the extension does not answer', async () => {
    vi.useFakeTimers();
    const request = requestRayenEncounterNavigation('141336', 50);

    await vi.advanceTimersByTimeAsync(51);

    await expect(request).resolves.toEqual({
      ok: false,
      reused: false,
      error: 'La extensión Eloísa no respondió. Recárgala y vuelve a intentarlo.',
    });
  });
});
