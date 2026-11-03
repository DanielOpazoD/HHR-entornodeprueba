import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchDicomInstance } from '@/services/radiology/mmradDicomService';
import { createDicomDownloadQueue } from '@/services/radiology/dicomDownloadQueue';
import {
  DicomOriginalTooLargeError,
  DicomTicketExpiredError,
  DicomTransferError,
} from '@/services/radiology/dicomLoadState';

vi.mock('@/services/auth/authRequestHeaders', () => ({
  resolveCurrentUserAuthHeaders: async () => ({ Authorization: 'Bearer synthetic-id-token' }),
}));
vi.mock('@/services/firebase-runtime/firebaseConfigRuntimeAdapter', () => ({
  defaultFirebaseConfigRuntimeAdapter: {
    getOptionalApp: () => ({ options: { projectId: 'demo-hhr-radiology' } }),
  },
}));

const SANTIAGO =
  'https://southamerica-west1-demo-hhr-radiology.cloudfunctions.net/mmradDicomSantiago';
// Synthetic size of a measured radiograph original; the bytes themselves are a small stand-in.
const RADIOGRAPH_BYTES = 24_263_704;
const ORIGINAL = new Uint8Array([68, 73, 67, 77, 1, 2, 3]);
const bridgeTooLarge = (bytes: number | undefined = RADIOGRAPH_BYTES) =>
  new Response(
    JSON.stringify({ error: 'Synthetic', code: 'too-large', ...(bytes ? { bytes } : {}) }),
    { status: 413 }
  );
const dicom = () =>
  new Response(ORIGINAL, {
    headers: { 'Content-Type': 'application/dicom', 'Server-Timing': 'upstream;dur=900' },
  });
const routed = (
  santiago: (init: RequestInit) => Promise<Response>,
  bridge = () => bridgeTooLarge()
) =>
  vi.fn(async (url: string, init: RequestInit) => (url === SANTIAGO ? santiago(init) : bridge()));
const tooLargeMessage = /^Esta imagen pesa 24,3 MB y supera .*«MMRAD».*Universitas/;

afterEach(() => vi.unstubAllGlobals());

describe('full radiographs from Santiago when the bridge cannot carry them', () => {
  it('brings an original the bridge refused as too large from the Santiago function', async () => {
    const fetchMock = routed(async () => dicom());
    vi.stubGlobal('fetch', fetchMock);
    const timing = vi.fn();
    const bytes = await fetchDicomInstance(
      'synthetic-ticket',
      new AbortController().signal,
      timing
    );
    expect(bytes).toEqual(ORIGINAL);
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      '/.netlify/functions/mmrad-dicom',
      SANTIAGO,
    ]);
    const init = fetchMock.mock.calls[1][1] as RequestInit;
    expect(init).toMatchObject({
      method: 'POST',
      cache: 'no-store',
      credentials: 'omit',
      headers: { Authorization: 'Bearer synthetic-id-token' },
    });
    expect(JSON.parse(String(init.body))).toEqual({ ticket: 'synthetic-ticket' });
    expect(timing).toHaveBeenCalledWith(
      expect.objectContaining({ upstream: 900, upstreamSamples: 1 }),
      ORIGINAL.length
    );
  });

  it.each([
    ['refuses the ticket', async () => new Response('{"error":"x"}', { status: 403 })],
    ['does not exist', async () => new Response('{"error":"x"}', { status: 404 })],
    ['answers something other than DICOM', async () => new Response('<html>')],
    [
      'cannot be reached (no function, CORS or invoker)',
      async () => {
        throw new TypeError('Failed to fetch');
      },
    ],
    ['refuses it as too large too', async () => bridgeTooLarge(31_000_000)],
  ])('keeps the too-large message when Santiago %s', async (_case, santiago) => {
    vi.stubGlobal('fetch', routed(santiago));
    const result = fetchDicomInstance('synthetic-ticket', new AbortController().signal);
    await expect(result).rejects.toBeInstanceOf(DicomOriginalTooLargeError);
    await expect(result).rejects.toMatchObject({ transient: false, message: tooLargeMessage });
  });

  it('retries a transient Santiago failure and renews an expired ticket like the bridge', async () => {
    vi.stubGlobal(
      'fetch',
      routed(async () => new Response('{}', { status: 503, headers: { 'Retry-After': '4' } }))
    );
    const busy = fetchDicomInstance('synthetic-ticket', new AbortController().signal);
    await expect(busy).rejects.toMatchObject({ transient: true, retryAfterMs: 4000 });
    await expect(busy).rejects.not.toBeInstanceOf(DicomOriginalTooLargeError);

    // The 25 MB body is cut halfway through.
    const interrupted = new Response(
      new ReadableStream({ pull: controller => controller.error(new TypeError('network lost')) }),
      { headers: { 'Content-Type': 'application/dicom' } }
    );
    vi.stubGlobal(
      'fetch',
      routed(async () => interrupted)
    );
    await expect(
      fetchDicomInstance('synthetic-ticket', new AbortController().signal)
    ).rejects.toMatchObject({ transient: true, message: 'La conexión DICOM falló temporalmente.' });

    vi.stubGlobal(
      'fetch',
      routed(
        async () =>
          new Response(JSON.stringify({ error: 'x', code: 'ticket-expired' }), { status: 403 })
      )
    );
    await expect(
      fetchDicomInstance('synthetic-ticket', new AbortController().signal)
    ).rejects.toBeInstanceOf(DicomTicketExpiredError);
  });

  it('respects the prefetch room: no download beyond it, and the message when it overflows', async () => {
    const fetchMock = routed(async () => dicom());
    vi.stubGlobal('fetch', fetchMock);
    const declared = fetchDicomInstance(
      'synthetic-ticket',
      new AbortController().signal,
      undefined,
      RADIOGRAPH_BYTES - 1
    );
    await expect(declared).rejects.toMatchObject({ message: tooLargeMessage });
    expect(fetchMock).toHaveBeenCalledOnce();

    vi.stubGlobal(
      'fetch',
      routed(
        async () => dicom(),
        () => bridgeTooLarge(undefined)
      )
    );
    await expect(
      fetchDicomInstance('synthetic-ticket', new AbortController().signal, undefined, 3)
    ).rejects.toMatchObject({ message: /^Esta imagen supera los 3,5 MB/ });
  });

  it('stops at once when the viewer cancels the Santiago download', async () => {
    const fetchMock = routed(
      ({ signal }) =>
        new Promise<Response>((_resolve, reject) => {
          signal!.addEventListener('abort', () => reject(signal!.reason), { once: true });
        })
    );
    vi.stubGlobal('fetch', fetchMock);
    const controller = new AbortController();
    const task = fetchDicomInstance('synthetic-ticket', controller.signal);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    controller.abort();
    await expect(task).rejects.toMatchObject({ name: 'AbortError' });
    await expect(task).rejects.not.toBeInstanceOf(DicomTransferError);
  });

  it('lets the series queue retry Santiago and show the message if it finally refuses', async () => {
    let santiagoCalls = 0;
    vi.stubGlobal(
      'fetch',
      routed(async () => (++santiagoCalls === 1 ? new Response('{}', { status: 502 }) : dicom()))
    );
    const ready = await new Promise<string>((resolve, reject) => {
      const queue = createDicomDownloadQueue(
        1,
        new AbortController().signal,
        index => fetchDicomInstance(`synthetic-ticket-${index}`, new AbortController().signal),
        async index => `synthetic-image-${index}`,
        reject,
        () => undefined
      );
      void queue.request(0).then(resolve, reject);
    });
    expect(ready).toBe('synthetic-image-0');
    expect(santiagoCalls).toBe(2);

    vi.stubGlobal(
      'fetch',
      routed(async () => new Response('{}', { status: 403 }))
    );
    const fatal = await new Promise<unknown>(resolve => {
      createDicomDownloadQueue(
        1,
        new AbortController().signal,
        index => fetchDicomInstance(`synthetic-ticket-${index}`, new AbortController().signal),
        async index => `synthetic-image-${index}`,
        resolve,
        () => undefined
      );
    });
    expect(fatal).toMatchObject({ message: tooLargeMessage });
  });
});
