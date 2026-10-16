import { afterEach, describe, expect, it, vi } from 'vitest';
import { createClinicalFillReaders } from '@/features/rayen-import/bridge/clinicalFillReaders';
import type { PatientData } from '@/types/domain/patient';
import { requestEgresoLookup } from '@/features/rayen-import/bridge/rayenImportBridge';

vi.mock('@/features/rayen-import/bridge/extensionHealthBridge', () => ({
  RAYEN_PATIENT_CLINICAL_BUNDLE_CAPABILITY: 'patient-clinical-bundle',
  hasRayenExtensionCapability: () => true,
}));

const readers = (signal: AbortSignal) => {
  const api = createClinicalFillReaders(signal);
  return [
    () => api.fetchDeviceReport('episode', '2026-09-27'),
    () => api.fetchHistoryScales('episode', '2026-09-27', { lookbackDays: 7 }),
    () => api.fetchScalesForms('episode'),
    () => api.fetchPatientClinicalBundle('episode', '2026-09-27', {}),
    () => api.fetchCudyrCategories(),
  ];
};

describe('stage-bound clinical readers', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('cancels the authorization capture with its clinical stage', async () => {
    vi.useFakeTimers();
    const post = vi.spyOn(window, 'postMessage').mockImplementation(() => undefined);
    const controller = new AbortController();
    const api = createClinicalFillReaders(controller.signal, [
      {
        bedId: 'R1',
        clinicalCrib: false,
        patient: {
          patientName: 'Paciente sintético',
          rut: '12.345.678-5',
          clinicalEpisodeId: '142040',
        } as PatientData,
      },
    ]);
    const first = api.fetchScalesForms('142040');
    const request = post.mock.calls[0][0];
    window.dispatchEvent(
      new MessageEvent('message', {
        source: window,
        origin: window.location.origin,
        data: {
          type: 'HHR_RAYEN_SCALES_REPORT_RESULT',
          reqId: request.reqId,
          forms: [],
          error: 'Las escalas no fueron autorizadas para el episodio de esta pestaña.',
        },
      })
    );
    await first;
    const retry = api.fetchScalesForms('142040');
    expect(post.mock.calls[1][0].type).toBe('HHR_RAYEN_REQUEST_SYNC_BUNDLE');
    controller.abort();
    await expect(retry).rejects.toMatchObject({ name: 'AbortError' });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('cancels an exact-episode lookup without leaving its bridge timer', async () => {
    vi.useFakeTimers();
    vi.spyOn(window, 'postMessage').mockImplementation(() => undefined);
    const controller = new AbortController();
    const pending = requestEgresoLookup(
      [{ run: '123456785', encounterId: '142040' }],
      undefined,
      controller.signal
    );
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('cancels all five in-flight page channels promptly with no timers left', async () => {
    vi.useFakeTimers();
    const post = vi.spyOn(window, 'postMessage').mockImplementation(() => undefined);
    const controller = new AbortController();
    const results = Promise.allSettled(readers(controller.signal).map(read => read()));
    expect(post).toHaveBeenCalledTimes(5);
    controller.abort(new DOMException('Stage cancelled', 'AbortError'));
    expect(await results).toEqual(
      Array.from({ length: 5 }, () => ({
        status: 'rejected',
        reason: expect.objectContaining({ name: 'AbortError' }),
      }))
    );
    expect(vi.getTimerCount()).toBe(0);
  });

  it('allows the worker backend deadline to elapse before timing out individual channels', async () => {
    vi.useFakeTimers();
    const post = vi.spyOn(window, 'postMessage').mockImplementation(() => undefined);
    const controller = new AbortController();
    const done = vi.fn();
    const pending = Promise.all(readers(controller.signal).map(read => read().then(done)));
    await vi.advanceTimersByTimeAsync(50_000);
    expect(done).not.toHaveBeenCalled();
    for (const [request] of post.mock.calls) {
      const type = String(request.type).replace(/_REQUEST$/, '_RESULT');
      window.dispatchEvent(
        new MessageEvent('message', {
          source: window,
          origin: window.location.origin,
          data: {
            type,
            reqId: request.reqId,
            items: [],
            events: [],
            forms: [],
            devices: { entries: [] },
            history: { events: [] },
            base64: '',
          },
        })
      );
    }
    await pending;
    expect(done).toHaveBeenCalledTimes(5);
    expect(vi.getTimerCount()).toBe(0);
  });
});
