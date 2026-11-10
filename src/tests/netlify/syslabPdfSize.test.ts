import { describe, expect, it, vi } from 'vitest';
import { createSyslabProxyHarness } from './support/syslabProxyHarness';

const LIMIT = 4 * 1024 * 1024;
const BLOCK = 64 * 1024;
const INVALID_PDF = 'El servidor no entregó un PDF válido de laboratorio.';
const event = {
  httpMethod: 'GET',
  headers: { authorization: 'Bearer synthetic-token' },
  rawQuery: 'action=pdf&link=https%3A%2F%2Flab.example.com%2Fpdf%2Fsynthetic',
};

const oversizedPdf = (contentLength?: string) => {
  let delivered = 0;
  const cancel = vi.fn();
  const stream = new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        if (delivered === 25 * 1024 * 1024) {
          controller.close();
          return;
        }
        const chunk = new Uint8Array(BLOCK);
        if (delivered === 0) chunk.set(Buffer.from('%PDF-1.4'));
        delivered += chunk.length;
        controller.enqueue(chunk);
      },
      cancel,
    },
    { highWaterMark: 0 }
  );
  const response = new Response(stream, {
    headers: contentLength ? { 'Content-Length': contentLength } : {},
  });
  return { response, cancel, delivered: () => delivered };
};

describe('Syslab PDF download size', () => {
  const { fetchMock, loadHandler } = createSyslabProxyHarness();

  it.each([undefined, '1024'])(
    'cancels a 25 MiB stream with length %s at the limit plus one block',
    async length => {
      const upstream = oversizedPdf(length);
      fetchMock.mockResolvedValue(upstream.response);
      const handler = await loadHandler();
      const response = await handler(event);

      expect(response.statusCode).toBe(502);
      expect(response.body).toBe(INVALID_PDF);
      expect(upstream.delivered()).toBeLessThanOrEqual(LIMIT + BLOCK);
      expect(upstream.cancel).toHaveBeenCalledOnce();
      expect(upstream.response.body?.locked).toBe(false);
    }
  );

  it('rejects an oversized Content-Length without reading the body', async () => {
    const upstream = oversizedPdf(String(25 * 1024 * 1024));
    fetchMock.mockResolvedValue(upstream.response);
    const handler = await loadHandler();
    const response = await handler(event);

    expect(response.statusCode).toBe(502);
    expect(response.body).toBe(INVALID_PDF);
    expect(upstream.delivered()).toBe(0);
    expect(upstream.cancel).toHaveBeenCalledOnce();
  });

  it.each([32, LIMIT])('preserves all PDF bytes for a valid %s byte response', async size => {
    const bytes = Buffer.alloc(size, 0x61);
    bytes.set(Buffer.from('%PDF-1.4'));
    fetchMock.mockResolvedValue(new Response(bytes));
    const handler = await loadHandler();
    const response = await handler(event);

    expect(response).toEqual({
      statusCode: 200,
      headers: { 'Content-Type': 'application/pdf', 'Cache-Control': 'no-store' },
      body: bytes.toString('base64'),
      isBase64Encoded: true,
    });
  });

  it('preserves the non-PDF rejection', async () => {
    fetchMock.mockResolvedValue(new Response('<html>unavailable</html>'));
    const handler = await loadHandler();
    const response = await handler(event);
    expect(response.statusCode).toBe(502);
    expect(response.body).toBe(INVALID_PDF);
  });

  it('supports response doubles without a stream or headers', async () => {
    const bytes = new TextEncoder().encode('%PDF-1.4 synthetic');
    fetchMock.mockResolvedValue({ ok: true, arrayBuffer: async () => bytes.buffer });
    const handler = await loadHandler();
    const response = await handler(event);
    expect(response.statusCode).toBe(200);
    expect(response.body).toBe(Buffer.from(bytes).toString('base64'));
  });
});
