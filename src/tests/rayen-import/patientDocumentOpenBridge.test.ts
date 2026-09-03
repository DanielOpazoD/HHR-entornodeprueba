import { describe, expect, it, vi } from 'vitest';

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

    window.dispatchEvent(new MessageEvent('message', {
      origin: window.location.origin,
      source: window,
      data: {
        type: RAYEN_PATIENT_DOCUMENT_OPEN_RESULT_TYPE,
        reqId: outgoing.reqId,
        ok: true,
        opened: true,
      },
    }));
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
