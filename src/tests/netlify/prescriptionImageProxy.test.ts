import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('prescription-image-proxy', () => {
  const originalEnv = { ...process.env };
  const fetchMock = vi.fn();
  const transformImageMock = vi.fn();

  const loadHandler = async () => {
    const { createPrescriptionImageProxyHandler } =
      await import('../../../netlify/functions/prescription-image-proxy');
    return createPrescriptionImageProxyHandler({
      fetch: fetchMock as typeof fetchMock,
      transformImage: transformImageMock,
    });
  };

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    process.env = {
      ...originalEnv,
      URL: 'https://app.example.com',
      HHR_ALLOW_LOCAL_FUNCTION_ORIGINS: 'true',
      VITE_FIREBASE_STORAGE_BUCKET: 'hhr-pruebas.firebasestorage.app',
      VITE_FIREBASE_PROJECT_ID: '',
    };
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'image/jpeg' }),
      arrayBuffer: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3]).buffer),
    });
    transformImageMock.mockResolvedValue(Buffer.from([9, 8, 7]));
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('resizes a signed Firebase Storage prescription image with explicit width and quality', async () => {
    const handler = await loadHandler();
    const sourceUrl =
      'https://firebasestorage.googleapis.com/v0/b/hhr-pruebas.firebasestorage.app/o/prescriptions%2Fhhr%2Frx-1%2Ffull.jpg?alt=media&token=stub';

    const response = (await handler({
      httpMethod: 'GET',
      headers: { origin: 'http://localhost:3021' },
      body: null,
      rawQuery: new URLSearchParams({
        url: sourceUrl,
        w: '760',
        q: '58',
      }).toString(),
    })) as {
      statusCode: number;
      headers?: Record<string, string>;
      body: string;
      isBase64Encoded?: boolean;
    };

    expect(response.statusCode).toBe(200);
    expect(response.isBase64Encoded).toBe(true);
    expect(response.headers?.['Content-Type']).toBe('image/jpeg');
    expect(response.headers?.['X-Prescription-Image-Optimization']).toBe('optimized');
    expect(response.headers?.['X-Content-Type-Options']).toBe('nosniff');
    expect(response.headers?.['Content-Security-Policy']).toBe("default-src 'none'; sandbox");
    expect(response.headers?.['Access-Control-Allow-Origin']).toBe('http://localhost:3021');
    expect(fetchMock).toHaveBeenCalledWith(sourceUrl);
    expect(transformImageMock).toHaveBeenCalledWith(expect.any(Uint8Array), {
      width: 760,
      quality: 58,
    });
    expect(response.body).toBe(Buffer.from([9, 8, 7]).toString('base64'));
  });

  it('rejects non-Firebase image sources', async () => {
    const handler = await loadHandler();

    const response = await handler({
      httpMethod: 'GET',
      headers: { origin: 'http://localhost:3021' },
      body: null,
      rawQuery: new URLSearchParams({
        url: 'https://example.com/rx.jpg',
        w: '760',
        q: '58',
      }).toString(),
    });

    expect(response.statusCode).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    'https://firebasestorage.googleapis.com/v0/b/other-project.firebasestorage.app/o/prescriptions%2Fx.jpg?alt=media',
    'https://other-project.firebasestorage.app/v0/b/hhr-pruebas.firebasestorage.app/o/prescriptions%2Fx.jpg?alt=media',
    'https://firebasestorage.googleapis.com/v0/b/hhr-pruebas.firebasestorage.app/o/avatars%2Fx.jpg?alt=media',
  ])('rejects a source outside the HHR prescriptions bucket: %s', async sourceUrl => {
    const handler = await loadHandler();

    const response = await handler({
      httpMethod: 'GET',
      headers: {},
      body: null,
      rawQuery: new URLSearchParams({ url: sourceUrl }).toString(),
    });

    expect(response.statusCode).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects every remote source when no bucket is configured', async () => {
    process.env.VITE_FIREBASE_STORAGE_BUCKET = '';
    const handler = await loadHandler();

    const response = await handler({
      httpMethod: 'GET',
      headers: {},
      body: null,
      rawQuery: new URLSearchParams({
        url: 'https://firebasestorage.googleapis.com/v0/b/hhr-pruebas.firebasestorage.app/o/prescriptions%2Fx.jpg?alt=media',
      }).toString(),
    });

    expect(response.statusCode).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('never passes through a file the optimizer cannot read unless it is an image', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'text/html; charset=utf-8' }),
      arrayBuffer: vi.fn().mockResolvedValue(new TextEncoder().encode('<script></script>').buffer),
    });
    transformImageMock.mockRejectedValueOnce(new Error('unsupported image format'));
    const handler = await loadHandler();

    const response = (await handler({
      httpMethod: 'GET',
      headers: {},
      body: null,
      rawQuery: new URLSearchParams({
        url: 'https://firebasestorage.googleapis.com/v0/b/hhr-pruebas.firebasestorage.app/o/prescriptions%2Fx.html?alt=media',
      }).toString(),
    })) as { statusCode: number; headers?: Record<string, string>; body: string };

    expect(response.statusCode).toBe(415);
    expect(response.headers?.['Content-Type']).toContain('application/json');
    expect(response.body).not.toContain('<script>');
    warnSpy.mockRestore();
  });

  it('falls back to the source image when optimization fails', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    transformImageMock.mockRejectedValueOnce(new Error('sharp native runtime unavailable'));
    const handler = await loadHandler();
    const sourceUrl =
      'https://firebasestorage.googleapis.com/v0/b/hhr-pruebas.firebasestorage.app/o/prescriptions%2Fhhr%2Frx-1%2Ffull.jpg?alt=media&token=stub';

    const response = (await handler({
      httpMethod: 'GET',
      headers: { origin: 'http://localhost:3021' },
      body: null,
      rawQuery: new URLSearchParams({
        url: sourceUrl,
        w: '760',
        q: '58',
      }).toString(),
    })) as {
      statusCode: number;
      headers?: Record<string, string>;
      body: string;
      isBase64Encoded?: boolean;
    };

    expect(response.statusCode).toBe(200);
    expect(response.isBase64Encoded).toBe(true);
    expect(response.headers?.['Content-Type']).toBe('image/jpeg');
    expect(response.headers?.['X-Prescription-Image-Optimization']).toBe('fallback');
    expect(response.body).toBe(Buffer.from([1, 2, 3]).toString('base64'));
    expect(warnSpy).toHaveBeenCalledWith(
      'Prescription image optimization fallback',
      expect.any(Error)
    );
    warnSpy.mockRestore();
  });

  it('allows local fixture images only when the smoke-test flag is enabled', async () => {
    process.env.HHR_ALLOW_PRESCRIPTION_IMAGE_PROXY_FIXTURE = 'true';
    const handler = await loadHandler();

    const response = await handler({
      httpMethod: 'GET',
      headers: { origin: 'http://localhost:3021' },
      body: null,
      rawQuery: new URLSearchParams({
        url: 'http://127.0.0.1:39391/prescription-fixture.jpg',
        w: '760',
        q: '58',
      }).toString(),
    });

    expect(response.statusCode).toBe(200);
    expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:39391/prescription-fixture.jpg');
  });

  it('rejects local fixture images without the smoke-test flag', async () => {
    const handler = await loadHandler();

    const response = await handler({
      httpMethod: 'GET',
      headers: { origin: 'http://localhost:3021' },
      body: null,
      rawQuery: new URLSearchParams({
        url: 'http://127.0.0.1:39391/prescription-fixture.jpg',
        w: '760',
        q: '58',
      }).toString(),
    });

    expect(response.statusCode).toBe(400);
  });
});
