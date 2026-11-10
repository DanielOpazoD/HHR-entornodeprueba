import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPrescriptionImageProxyHandler } from '../../../netlify/functions/prescription-image-proxy';
import type { NetlifyEventLike } from '../../../netlify/functions/lib/http';

const origin = 'https://app.example.com';
const source =
  'https://firebasestorage.googleapis.com/v0/b/synthetic.firebasestorage.app/o/prescriptions%2Ffixture.jpg?alt=media';
const cors = (requestOrigin: string | undefined, methods = 'GET,POST,OPTIONS') => ({
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, Accept, X-User-Role',
  'Access-Control-Allow-Methods': methods,
  Vary: 'Origin',
  ...(requestOrigin === origin ? { 'Access-Control-Allow-Origin': origin } : {}),
});
const json = (statusCode: number, error: string, requestOrigin: string | undefined = origin) => ({
  statusCode,
  headers: { ...cors(requestOrigin), 'Content-Type': 'application/json; charset=utf-8' },
  body: JSON.stringify({ error }),
});
const image = (requestOrigin: string | undefined, fallback = false, type = 'image/jpeg') => ({
  statusCode: 200,
  headers: {
    ...cors(requestOrigin, 'GET,OPTIONS'),
    'Cache-Control': 'no-store',
    'Content-Type': type,
    'Content-Security-Policy': "default-src 'none'; sandbox",
    'X-Content-Type-Options': 'nosniff',
    'X-Prescription-Image-Optimization': fallback ? 'fallback' : 'optimized',
  },
  body: Buffer.from(fallback ? [1, 2, 3] : [9, 8, 7]).toString('base64'),
  isBase64Encoded: true,
});

describe('prescription image complete wire oracle (unmodified main)', () => {
  const fetchMock = vi.fn<typeof fetch>();
  const transformImage =
    vi.fn<
      (input: Uint8Array, options: { width: number; quality: number }) => Promise<Uint8Array>
    >();
  const handler = createPrescriptionImageProxyHandler({ fetch: fetchMock, transformImage });
  const event = (overrides: Partial<NetlifyEventLike> = {}): NetlifyEventLike => ({
    httpMethod: 'GET',
    headers: { origin },
    rawQuery: new URLSearchParams({ url: source }).toString(),
    ...overrides,
  });
  beforeEach(() => {
    vi.stubEnv('URL', origin);
    vi.stubEnv('DEPLOY_PRIME_URL', '');
    vi.stubEnv('DEPLOY_URL', '');
    vi.stubEnv('SITE_URL', '');
    vi.stubEnv('APP_URL', '');
    vi.stubEnv('SITE_NAME', 'synthetic-hhr');
    vi.stubEnv('VITE_FIREBASE_STORAGE_BUCKET', 'synthetic.firebasestorage.app');
    vi.stubEnv('VITE_FIREBASE_PROJECT_ID', '');
    vi.stubEnv('HHR_ALLOW_LOCAL_FUNCTION_ORIGINS', 'false');
    vi.stubEnv('HHR_ALLOW_PRESCRIPTION_IMAGE_PROXY_FIXTURE', 'false');
    fetchMock.mockReset().mockImplementation(
      async () =>
        new Response(new Uint8Array([1, 2, 3]), {
          headers: { 'content-type': 'image/jpeg' },
        })
    );
    transformImage.mockReset().mockResolvedValue(new Uint8Array([9, 8, 7]));
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('allowed preflight is empty, exact, repeatable and bypasses invalid query', async () => {
    const expected = {
      statusCode: 200,
      headers: { ...cors(origin, 'GET,OPTIONS'), 'Cache-Control': 'no-store' },
      body: '',
    };
    for (let i = 0; i < 2; i++) {
      expect(await handler(event({ httpMethod: 'OPTIONS', rawQuery: '' }))).toEqual(expected);
    }
    expect(fetchMock).not.toHaveBeenCalled();
    expect(transformImage).not.toHaveBeenCalled();
  });
  it.each(['OPTIONS', 'POST', 'GET'])(
    'hostile origin precedes %s and query validation',
    async httpMethod => {
      expect(
        await handler(
          event({ httpMethod, headers: { Origin: 'https://hostile.example' }, rawQuery: '' })
        )
      ).toEqual(json(403, 'Origin not allowed', 'https://hostile.example'));
      expect(fetchMock).not.toHaveBeenCalled();
    }
  );
  it('method precedes query validation', async () => {
    expect(await handler(event({ httpMethod: 'POST', rawQuery: '' }))).toEqual(
      json(405, 'Method not allowed')
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('absent origin permits the image without Allow-Origin', async () => {
    expect(await handler(event({ headers: {} }))).toEqual(image(undefined));
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith(source);
  });
  it.each([
    '',
    'url=invalid',
    new URLSearchParams({ url: 'https://external.example/image.jpg' }).toString(),
  ])('invalid source: %s', async rawQuery => {
    expect(await handler(event({ rawQuery }))).toEqual(
      json(400, 'Invalid prescription image source.')
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it.each([
    ['w=invalid&q=NaN', 760, 58],
    ['w=-1&q=999', 360, 80],
    ['w=9999&q=-1', 1200, 40],
    ['w=760.6&q=58.6', 761, 59],
    ['', 360, 40],
  ])('numeric parameters keep normalization: %s', async (query, width, quality) => {
    expect(
      await handler(event({ rawQuery: `${new URLSearchParams({ url: source })}&${query}` }))
    ).toEqual(image(origin));
    expect(transformImage).toHaveBeenCalledExactlyOnceWith(new Uint8Array([1, 2, 3]), {
      width,
      quality,
    });
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith(source);
  });
  it('upstream status failure', async () => {
    fetchMock.mockResolvedValue(new Response('', { status: 503 }));
    expect(await handler(event())).toEqual(json(502, 'Image source responded with 503.'));
    expect(transformImage).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it('network exception has no retry', async () => {
    fetchMock.mockRejectedValue(new Error('synthetic network error'));
    expect(await handler(event())).toEqual(json(502, 'No se pudo optimizar la imagen de receta.'));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it('body read exception', async () => {
    const response = new Response('');
    vi.spyOn(response, 'arrayBuffer').mockRejectedValue(new Error('synthetic body error'));
    fetchMock.mockResolvedValue(response);
    expect(await handler(event())).toEqual(json(502, 'No se pudo optimizar la imagen de receta.'));
  });
  it.each(['image/jpeg', 'image/png', 'image/webp'])(
    'transform exception preserves allowed %s bytes',
    async type => {
      fetchMock.mockResolvedValue(
        new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': type } })
      );
      transformImage.mockRejectedValue(new Error('synthetic transform error'));
      expect(await handler(event())).toEqual(image(origin, true, type));
    }
  );
  it('transform exception rejects unsupported type', async () => {
    fetchMock.mockResolvedValue(
      new Response('synthetic text', { headers: { 'content-type': 'text/html' } })
    );
    transformImage.mockRejectedValue(new Error('synthetic transform error'));
    expect(await handler(event())).toEqual(json(415, 'Unsupported prescription image type.'));
  });
});
