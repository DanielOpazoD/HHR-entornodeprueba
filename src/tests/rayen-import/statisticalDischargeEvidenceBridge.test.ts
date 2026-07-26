import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  RAYEN_STATISTICAL_DISCHARGE_EVIDENCE_REQUEST_TYPE,
  RAYEN_STATISTICAL_DISCHARGE_EVIDENCE_RESULT_TYPE,
  requestStatisticalDischargeEvidence,
} from '@/features/rayen-import/bridge/statisticalDischargeEvidenceBridge';

describe('statistical discharge evidence bridge', () => {
  afterEach(() => vi.restoreAllMocks());

  it('correlates one exact episode response and ignores foreign window messages', async () => {
    const post = vi.spyOn(window, 'postMessage');
    const pending = requestStatisticalDischargeEvidence('142083', 1000);
    const request = post.mock.calls.find(
      ([message]) =>
        (message as { type?: string }).type === RAYEN_STATISTICAL_DISCHARGE_EVIDENCE_REQUEST_TYPE
    )?.[0] as { reqId: string };

    window.dispatchEvent(
      new MessageEvent('message', {
        data: {
          type: RAYEN_STATISTICAL_DISCHARGE_EVIDENCE_RESULT_TYPE,
          reqId: 'otro',
          base64: 'incorrecto',
        },
        origin: window.location.origin,
        source: window,
      })
    );
    window.dispatchEvent(
      new MessageEvent('message', {
        data: {
          type: RAYEN_STATISTICAL_DISCHARGE_EVIDENCE_RESULT_TYPE,
          reqId: request.reqId,
          base64: 'JVBERg==',
        },
        origin: window.location.origin,
        source: window,
      })
    );

    await expect(pending).resolves.toEqual({ base64: 'JVBERg==', error: undefined });
  });

  it('rejects an invalid encounter before posting', async () => {
    const post = vi.spyOn(window, 'postMessage');
    await expect(requestStatisticalDischargeEvidence('../otro')).resolves.toEqual({
      base64: '',
      error: 'El episodio clínico no es válido.',
    });
    expect(post).not.toHaveBeenCalled();
  });
});
