import { describe, expect, it, vi } from 'vitest';

import {
  RAYEN_PATIENT_DOCUMENT_MANAGER_REQUEST_TYPE,
  RAYEN_PATIENT_DOCUMENT_MANAGER_RESULT_TYPE,
  requestRayenPatientDocumentManager,
} from '@/features/rayen-import/bridge/patientDocumentManagerBridge';

describe('patient document manager browser bridge', () => {
  it('requests a count for the exact episode and accepts only a non-negative integer', async () => {
    const posted: Record<string, unknown>[] = [];
    const listener = (event: MessageEvent) => posted.push(event.data as Record<string, unknown>);
    window.addEventListener('message', listener);
    const pending = requestRayenPatientDocumentManager('141121', 'count');
    await vi.waitFor(() =>
      expect(posted.some(item => item.type === RAYEN_PATIENT_DOCUMENT_MANAGER_REQUEST_TYPE)).toBe(true)
    );
    const outgoing = posted.find(item => item.type === RAYEN_PATIENT_DOCUMENT_MANAGER_REQUEST_TYPE)!;
    window.removeEventListener('message', listener);
    window.dispatchEvent(new MessageEvent('message', {
      origin: window.location.origin,
      source: window,
      data: {
        type: RAYEN_PATIENT_DOCUMENT_MANAGER_RESULT_TYPE,
        reqId: outgoing.reqId,
        ok: true,
        count: 4,
      },
    }));

    await expect(pending).resolves.toEqual({
      ok: true,
      count: 4,
      opened: false,
      reused: false,
      error: undefined,
    });
    expect(outgoing).toMatchObject({ encId: '141121', operation: 'count' });
  });

  it('rejects an invalid episode before crossing the page bridge', async () => {
    await expect(requestRayenPatientDocumentManager('not-an-episode', 'open')).resolves.toEqual({
      ok: false,
      error: 'El paciente no tiene un episodio válido para abrir documentos.',
    });
  });
});
