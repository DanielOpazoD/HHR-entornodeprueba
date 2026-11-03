import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchDicomInstance, fetchDicomStudy } from '@/services/radiology/mmradDicomService';
import {
  DicomOriginalTooLargeError,
  DicomTicketExpiredError,
} from '@/services/radiology/dicomLoadState';
vi.mock('@/services/auth/authRequestHeaders', () => ({
  resolveCurrentUserAuthHeaders: async () => ({}),
}));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
describe('DICOM transfer diagnostics and retry classification', () => {
  it('reports numeric timing only and keeps responses out of persistent HTTP caches', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(new Uint8Array([1, 2]), {
        headers: { 'Content-Type': 'application/dicom', 'Server-Timing': 'upstream;dur=12.5' },
      })
    );
    vi.stubGlobal('fetch', fetchMock);
    const timing = vi.fn();
    expect(
      await fetchDicomInstance('synthetic-ticket', new AbortController().signal, timing)
    ).toEqual(new Uint8Array([1, 2]));
    expect(fetchMock.mock.calls[0][1].cache).toBe('no-store');
    expect(timing.mock.calls[0][1]).toBe(2);
    expect(timing.mock.calls[0][0]).toMatchObject({ upstream: 12.5, upstreamSamples: 1 });
    expect(Object.values(timing.mock.calls[0][0]).every(value => typeof value === 'number')).toBe(
      true
    );
  });
  it('separates server authorization and upstream phases', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(new Uint8Array([1]), {
          headers: {
            'Server-Timing':
              'auth;dur=40, upstream;dur=30, upstream_headers;dur=20, upstream_body;dur=10',
          },
        })
      )
    );
    const timing = vi.fn();
    await fetchDicomInstance('synthetic-ticket', new AbortController().signal, timing);
    expect(timing.mock.calls[0][0]).toMatchObject({
      serverAuth: 40,
      upstream: 30,
      upstreamHeaders: 20,
      upstreamBody: 10,
      serverSamples: 1,
    });
  });
  it.each([
    [429, true],
    [503, true],
    [502, true],
    [401, false],
    [403, false],
    [422, false],
  ])('classifies HTTP %s without echoing response content', async (status, transient) => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response('{"error":"private server detail"}', {
          status: Number(status),
          headers: { 'Retry-After': '3' },
        })
      )
    );
    const result = fetchDicomInstance('synthetic-ticket', new AbortController().signal);
    await expect(result).rejects.toMatchObject({ transient, retryAfterMs: 3000 });
    await expect(result).rejects.not.toThrow('private');
  });
  it('recognises only a 403 coded ticket-expired as renewable access', async () => {
    const answer = (status: number, body: object) =>
      vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status }));
    vi.stubGlobal('fetch', answer(403, { error: 'Synthetic expired', code: 'ticket-expired' }));
    const expired = fetchDicomInstance('synthetic-ticket', new AbortController().signal);
    await expect(expired).rejects.toBeInstanceOf(DicomTicketExpiredError);
    await expect(expired).rejects.toMatchObject({
      transient: false,
      message: 'No se pudo obtener el corte. Vuelve a abrir el estudio.',
    });
    for (const [status, body] of [
      [403, { error: 'Synthetic invalid' }],
      [422, { error: 'Synthetic', code: 'ticket-expired' }],
    ] as const) {
      vi.stubGlobal('fetch', answer(status, body));
      const other = fetchDicomInstance('synthetic-ticket', new AbortController().signal);
      await expect(other).rejects.toMatchObject({ transient: false });
      await expect(other).rejects.not.toBeInstanceOf(DicomTicketExpiredError);
    }
  });
  it('asks for and verifies the MMRAD registration of a mistyped check digit', async () => {
    const study = (registeredPatientId?: string) => ({
      uid: '1.2.3',
      patientId: '111111111',
      ...(registeredPatientId ? { registeredPatientId } : {}),
      date: '',
      series: [{ uid: '1.2.3.4', instances: [] }],
    });
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(study('111111117'))));
    vi.stubGlobal('fetch', fetchMock);
    const opened = await fetchDicomStudy(
      'link',
      '11.111.111-1',
      new AbortController().signal,
      '11.111.111-7'
    );
    expect(opened.registeredPatientId).toBe('111111117');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({
      patientId: '11.111.111-1',
      registeredPatientId: '11.111.111-7',
    });
    for (const [answer, requested] of [
      [study(), '11.111.111-7'],
      [study('111111117'), undefined],
      [study('111111110'), '11.111.111-7'],
    ] as const) {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(answer))));
      await expect(
        fetchDicomStudy('link', '11.111.111-1', new AbortController().signal, requested)
      ).rejects.toThrow('no corresponde');
    }
  });
  it('explains an original too large for HHR and points to MMRAD, without retrying it', async () => {
    const answer = (body: object) =>
      vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status: 413 }));
    vi.stubGlobal('fetch', answer({ error: 'Synthetic', code: 'too-large', bytes: 24263704 }));
    const sized = fetchDicomInstance('synthetic-ticket', new AbortController().signal);
    await expect(sized).rejects.toBeInstanceOf(DicomOriginalTooLargeError);
    await expect(sized).rejects.toMatchObject({
      transient: false,
      message: expect.stringMatching(/pesa 24,3 MB .*3,5 MB.*«MMRAD».*Universitas/),
    });
    vi.stubGlobal('fetch', answer({ error: 'Synthetic', code: 'too-large' }));
    await expect(
      fetchDicomInstance('synthetic-ticket', new AbortController().signal)
    ).rejects.toMatchObject({ message: expect.stringMatching(/^Esta imagen supera los 3,5 MB/) });
    vi.stubGlobal('fetch', answer({ error: 'Synthetic' }));
    await expect(
      fetchDicomInstance('synthetic-ticket', new AbortController().signal)
    ).rejects.not.toBeInstanceOf(DicomOriginalTooLargeError);
  });
  it('retries a body-read AbortError when the patient session was not cancelled', async () => {
    const response = new Response(new Uint8Array([1]), {
      headers: { 'Content-Type': 'application/dicom' },
    });
    vi.spyOn(response, 'arrayBuffer').mockRejectedValue(
      new DOMException('Body interrupted', 'AbortError')
    );
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response));
    await expect(
      fetchDicomInstance('synthetic-ticket', new AbortController().signal)
    ).rejects.toMatchObject({ transient: true });
  });

  it('propagates user cancellation without classifying it as retryable', async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url, options) =>
          new Promise((_resolve, reject) => {
            options.signal.addEventListener('abort', () => reject(options.signal.reason), {
              once: true,
            });
          })
      )
    );
    // AbortSignal.timeout uses native time; a parent cancellation must propagate immediately.
    const controller = new AbortController();
    const task = fetchDicomInstance('synthetic-ticket', controller.signal);
    await vi.advanceTimersByTimeAsync(0);
    controller.abort();
    await expect(task).rejects.toMatchObject({ name: 'AbortError' });
  });
});
