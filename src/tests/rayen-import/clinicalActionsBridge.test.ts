import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { requestClinicalAction } from '@/features/rayen-import/bridge/clinicalActionsBridge';
describe('clinical action message lifetime', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });
  it('libera las consultas al cerrar el panel repetidamente', async () => {
    vi.spyOn(window, 'postMessage').mockImplementation(() => {});
    const add = vi.spyOn(window, 'addEventListener');
    const remove = vi.spyOn(window, 'removeEventListener');
    for (let i = 0; i < 30; i++) {
      const controller = new AbortController();
      const result = requestClinicalAction('123', 'list', undefined, controller.signal);
      controller.abort();
      expect((await result).ok).toBe(false);
    }
    expect(vi.getTimerCount()).toBe(0);
    expect(add.mock.calls.filter(([event]) => event === 'message')).toHaveLength(30);
    expect(remove.mock.calls.filter(([event]) => event === 'message')).toHaveLength(30);
  });
  it('ignora una respuesta de otro origen y acepta sólo la solicitud vigente', async () => {
    const post = vi.spyOn(window, 'postMessage').mockImplementation(() => {});
    const pending = requestClinicalAction('123', 'list');
    const reqId = post.mock.calls[0][0].reqId;
    window.dispatchEvent(
      new MessageEvent('message', {
        source: window,
        origin: 'https://untrusted.example',
        data: { type: 'HHR_RAYEN_CLINICAL_ACTION_RESULT', reqId, ok: true },
      })
    );
    expect(vi.getTimerCount()).toBe(1);
    window.dispatchEvent(
      new MessageEvent('message', {
        source: window,
        origin: window.location.origin,
        data: {
          type: 'HHR_RAYEN_CLINICAL_ACTION_RESULT',
          reqId,
          ok: true,
          entries: [null, { id: 'incomplete' }],
        },
      })
    );
    expect(await pending).toMatchObject({ ok: true, entries: [] });
    expect(vi.getTimerCount()).toBe(0);
  });
  it('conserva el detalle durante una actualización escalonada de la extensión', async () => {
    const post = vi.spyOn(window, 'postMessage').mockImplementation(() => {});
    const pending = requestClinicalAction('123', 'detail', 'Primaria:8');
    const reqId = post.mock.calls[0][0].reqId;
    window.dispatchEvent(
      new MessageEvent('message', {
        source: window,
        origin: window.location.origin,
        data: {
          type: 'HHR_RAYEN_CLINICAL_ACTION_RESULT',
          reqId,
          ok: true,
          detail: { reason: 'Motivo', history: 'Evolución', professional: 'Profesional' },
        },
      })
    );
    expect(await pending).toMatchObject({
      detail: { history: 'Evolución', attachments: [] },
    });
  });
  it('no deja listeners cuando el envío falla', async () => {
    vi.spyOn(window, 'postMessage').mockImplementation(() => {
      throw new Error('Send failed');
    });
    expect((await requestClinicalAction('123', 'prescription')).ok).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });
});
