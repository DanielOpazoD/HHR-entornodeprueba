import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  RAYEN_PATIENT_DOCUMENT_OPEN_REQUEST_TYPE,
  RAYEN_PATIENT_DOCUMENT_OPEN_RESULT_TYPE,
  requestPatientDocumentOpen,
} from '@/features/rayen-import/bridge/clinicalPanelBridge';

describe('patient document open bridge', () => {
  it('asks the extension to open only the selected opaque document id', async () => {
    const posted: Record<string, unknown>[] = [];
    const capture = (event: MessageEvent) => posted.push(event.data as Record<string, unknown>);
    window.addEventListener('message', capture);
    const pending = requestPatientDocumentOpen('141121', 'id:10');
    await vi.waitFor(() =>
      expect(posted.some(item => item.type === RAYEN_PATIENT_DOCUMENT_OPEN_REQUEST_TYPE)).toBe(true)
    );
    const outgoing = posted.find(item => item.type === RAYEN_PATIENT_DOCUMENT_OPEN_REQUEST_TYPE)!;
    window.removeEventListener('message', capture);
    expect(outgoing).toMatchObject({ encId: '141121', documentId: 'id:10' });
    expect(outgoing).not.toHaveProperty('url');

    window.dispatchEvent(
      new MessageEvent('message', {
        origin: window.location.origin,
        source: window,
        data: {
          type: RAYEN_PATIENT_DOCUMENT_OPEN_RESULT_TYPE,
          reqId: outgoing.reqId,
          ok: true,
          opened: true,
        },
      })
    );
    await expect(pending).resolves.toEqual({ ok: true, opened: true, error: undefined });
  });

  it('rejects missing episode or document ids before crossing the bridge', async () => {
    await expect(requestPatientDocumentOpen('', 'id:10')).resolves.toMatchObject({
      ok: false,
      opened: false,
    });
    await expect(requestPatientDocumentOpen('141121', '')).resolves.toMatchObject({
      ok: false,
      opened: false,
    });
  });
});

describe('patient document open completion', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('returns a failure and removes the listener when sending throws', async () => {
    vi.useFakeTimers();
    const remove = vi.spyOn(window, 'removeEventListener');
    vi.spyOn(window, 'postMessage').mockImplementation(() => {
      throw new Error('synthetic send failure');
    });
    await expect(requestPatientDocumentOpen('episode-test', 'id:10')).resolves.toMatchObject({
      ok: false,
      opened: false,
    });
    expect(remove).toHaveBeenCalledWith('message', expect.any(Function));
    expect(vi.getTimerCount()).toBe(0);
  });

  it('ignores replies with an incorrect origin, source or request id', async () => {
    vi.useFakeTimers();
    const post = vi.spyOn(window, 'postMessage').mockImplementation(() => undefined);
    const pending = requestPatientDocumentOpen('episode-test', 'id:10');
    const outgoing = post.mock.calls[0][0] as { reqId: string };
    let finished = false;
    void pending.then(() => {
      finished = true;
    });
    const reply = {
      type: RAYEN_PATIENT_DOCUMENT_OPEN_RESULT_TYPE,
      reqId: outgoing.reqId,
      ok: true,
      opened: true,
    };
    for (const event of [
      new MessageEvent('message', {
        origin: 'https://invalid.example',
        source: window,
        data: reply,
      }),
      new MessageEvent('message', { origin: window.location.origin, source: null, data: reply }),
      new MessageEvent('message', {
        origin: window.location.origin,
        source: window,
        data: { ...reply, reqId: 'other-request' },
      }),
    ]) {
      window.dispatchEvent(event);
      await Promise.resolve();
      expect(finished).toBe(false);
    }
    window.dispatchEvent(
      new MessageEvent('message', { origin: window.location.origin, source: window, data: reply })
    );
    await expect(pending).resolves.toMatchObject({ ok: true, opened: true });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('cleans up even when the extension responds synchronously during sending', async () => {
    vi.useFakeTimers();
    vi.spyOn(window, 'postMessage').mockImplementation(message => {
      window.dispatchEvent(
        new MessageEvent('message', {
          origin: window.location.origin,
          source: window,
          data: {
            type: RAYEN_PATIENT_DOCUMENT_OPEN_RESULT_TYPE,
            reqId: message.reqId,
            ok: true,
            opened: true,
          },
        })
      );
    });
    await expect(requestPatientDocumentOpen('episode-test', 'id:10')).resolves.toMatchObject({
      ok: true,
      opened: true,
    });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('removes the listener on timeout and ignores late duplicate replies', async () => {
    vi.useFakeTimers();
    const remove = vi.spyOn(window, 'removeEventListener');
    const post = vi.spyOn(window, 'postMessage').mockImplementation(() => undefined);
    const pending = requestPatientDocumentOpen('episode-test', 'id:10', 20_000);
    await vi.advanceTimersByTimeAsync(20_000);
    await expect(pending).resolves.toMatchObject({ ok: false, opened: false });
    const outgoing = post.mock.calls[0][0] as { reqId: string };
    window.dispatchEvent(
      new MessageEvent('message', {
        origin: window.location.origin,
        source: window,
        data: {
          type: RAYEN_PATIENT_DOCUMENT_OPEN_RESULT_TYPE,
          reqId: outgoing.reqId,
          ok: true,
          opened: true,
        },
      })
    );
    expect(remove).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});
