import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.unmock('@/services/radiology/mmradService');

vi.mock('@/services/utils/loggerScope', async () => {
  const { createLoggerScopeMock } = await import('@/tests/utils/loggerScopeMock');
  return createLoggerScopeMock();
});

vi.mock('@/services/auth/authRequestHeaders', () => ({
  resolveCurrentUserAuthHeaders: vi.fn().mockResolvedValue({
    Authorization: 'Bearer token-123',
  }),
}));

import {
  buildMMRADPdfUrl,
  buildMMRADPortalReceiptUrl,
  fetchMMRADPdfBlob,
  fetchMMRADPdfBlobUrl,
  fetchMMRADPortalReceiptHtml,
  searchMMRADExams,
} from '@/services/radiology/mmradService';

describe('mmradService', () => {
  const mockFetch = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = mockFetch;
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn(() => 'blob:mmrad-pdf'),
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('builds the proxied PDF URL with the encoded MMRAD link', () => {
    const pdfUrl = buildMMRADPdfUrl('https://ris.mmrad.cl/informePDF?id=1&prestacion=2');

    expect(pdfUrl).toContain('/.netlify/functions/mmrad-search?action=pdf&link=');
    expect(pdfUrl).toContain(encodeURIComponent('&prestacion=2'));
  });

  it('builds the proxied portal receipt URL with the encoded MMRAD link', () => {
    const receiptUrl = buildMMRADPortalReceiptUrl(
      'https://ris.mmrad.cl/web/portalpaciente/comprobante?id=1&prestacion=2'
    );

    expect(receiptUrl).toContain('/.netlify/functions/mmrad-search?action=portalReceipt&link=');
    expect(receiptUrl).toContain(encodeURIComponent('&prestacion=2'));
  });

  it('sends auth headers when searching MMRAD exams', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: () =>
        Promise.resolve({
          rut: '12345678-9',
          examenes: [],
        }),
    });

    const result = await searchMMRADExams({ rut: '12.345.678-9', dateFrom: '2026-01-01' });

    expect(result.examenes).toEqual([]);
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('rut=12345678-9'),
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer token-123',
        }),
      })
    );
  });

  it('surfaces a clearer authorization error for local Netlify dev sessions', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: () =>
        Promise.resolve({
          error:
            'Acceso denegado para MMRAD. Tu correo no tiene un rol autorizado en config/roles o la sesión local no corresponde al entorno actual.',
        }),
    });

    await expect(searchMMRADExams({ rut: '12.345.678-9' })).rejects.toThrow(
      /http:\/\/localhost:8888\/.*vuelve a iniciar sesión/i
    );
  });

  it('fetches the proxied PDF with auth headers and returns a blob URL', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      blob: () => Promise.resolve(new Blob(['pdf'], { type: 'application/pdf' })),
    });

    const result = await fetchMMRADPdfBlobUrl('https://ris.mmrad.cl/informePDF?id=1459869');

    expect(result).toBe('blob:mmrad-pdf');
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/.netlify/functions/mmrad-search?action=pdf&link='),
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer token-123',
        }),
      })
    );
  });

  it('returns the original PDF blob unchanged and forwards cancellation to the authenticated proxy', async () => {
    const original = new Blob(['%PDF synthetic original'], { type: 'application/pdf' });
    const controller = new AbortController();
    mockFetch.mockResolvedValueOnce({ ok: true, blob: () => Promise.resolve(original) });

    expect(await fetchMMRADPdfBlob('https://mmrad.example/pdf/1', controller.signal)).toBe(
      original
    );
    expect(mockFetch).toHaveBeenCalledWith(buildMMRADPdfUrl('https://mmrad.example/pdf/1'), {
      headers: { Authorization: 'Bearer token-123' },
      signal: controller.signal,
    });
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });

  it.each(['text/html', 'application/json', 'application/octet-stream', ''])(
    'rejects a non-PDF MIME type (%s) before creating a URL',
    async type => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        blob: () => Promise.resolve(new Blob(['not a PDF'], { type })),
      });
      await expect(fetchMMRADPdfBlobUrl('https://mmrad.example/pdf/1')).rejects.toThrow(
        'MMRAD no devolvió un PDF original válido.'
      );
      expect(URL.createObjectURL).not.toHaveBeenCalled();
    }
  );

  it('does not start a request after its owner cancelled during authentication', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      fetchMMRADPdfBlob('https://mmrad.example/pdf/1', controller.signal)
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('does not expose a failed PDF response body to callers', async () => {
    const readBody = vi.fn().mockResolvedValue({ error: 'private upstream exception' });
    mockFetch.mockResolvedValueOnce({ ok: false, json: readBody });
    await expect(fetchMMRADPdfBlob('https://mmrad.example/pdf/1')).rejects.toThrow(
      'No se pudo obtener el PDF original de MMRAD.'
    );
    expect(readBody).not.toHaveBeenCalled();
  });

  it('fetches the portal receipt HTML with auth headers', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      text: () => Promise.resolve('<html><body>Datos del paciente</body></html>'),
    });

    const result = await fetchMMRADPortalReceiptHtml(
      'https://ris.mmrad.cl/web/portalpaciente/comprobante?id=1459869'
    );

    expect(result).toContain('Datos del paciente');
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/.netlify/functions/mmrad-search?action=portalReceipt&link='),
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer token-123',
        }),
      })
    );
  });
});
