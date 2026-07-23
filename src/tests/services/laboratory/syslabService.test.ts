/**
 * @fileoverview Unit tests for the Syslab laboratory service.
 * Tests RUT cleaning, URL building, and API call behavior.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.unmock('@/services/laboratory/syslabService');

vi.mock('@/services/laboratory/syslabExtensionBridge', () => ({
  cleanRutForSyslab: (rut: string) =>
    rut.replace(/\./g, '').replace(/-.*$/, '').replace(/\D/g, '').trim(),
  requestSyslabExtensionStatus: vi.fn().mockResolvedValue({
    bridgeAvailable: false,
    connected: false,
    loginRequired: false,
    message: 'La extensión no respondió.',
  }),
  searchSyslabThroughExtension: vi.fn().mockResolvedValue({ bridgeAvailable: false }),
  fetchSyslabDetailsThroughExtension: vi.fn(),
  fetchSyslabPdfThroughExtension: vi.fn(),
  isSyslabExtensionLink: (link: string) => link.startsWith('hhr-syslab-extension://'),
}));

// Mock the scoped logger to avoid console noise
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
  cleanRutForSyslab,
  getSyslabBaseUrl,
  checkSyslabConnection,
  searchSyslabExams,
  fetchSyslabExamDetails,
  buildSyslabPdfUrl,
  fetchSyslabPdfBlobUrl,
} from '@/services/laboratory/syslabService';

const setImportMetaEnv = (values: Record<string, unknown>) => {
  Object.assign(import.meta.env as Record<string, unknown>, values);
};

const setRuntimeLocation = (port: string) => {
  vi.stubGlobal('location', {
    hostname: 'localhost',
    port,
  });
};

describe('cleanRutForSyslab', () => {
  it('strips dots from formatted RUT', () => {
    expect(cleanRutForSyslab('12.345.678-9')).toBe('12345678');
  });

  it('strips dash and check digit', () => {
    expect(cleanRutForSyslab('12345678-9')).toBe('12345678');
  });

  it('handles RUT with K check digit', () => {
    expect(cleanRutForSyslab('5.600.574-K')).toBe('5600574');
  });

  it('returns numeric body when already clean', () => {
    expect(cleanRutForSyslab('12345678')).toBe('12345678');
  });

  it('trims whitespace', () => {
    expect(cleanRutForSyslab('  12345678-9  ')).toBe('12345678');
  });

  it('handles dots and dash together', () => {
    expect(cleanRutForSyslab('5.600.574-9')).toBe('5600574');
  });

  it('removes the verifier from the selected HHR patient RUT', () => {
    expect(cleanRutForSyslab('29.219.852-3')).toBe('29219852');
  });
});

describe('getSyslabBaseUrl', () => {
  it('does not assume that the HHR dev server is a Syslab proxy', () => {
    setImportMetaEnv({ VITE_SYSLAB_API_URL: undefined });
    expect(getSyslabBaseUrl()).toBe('');
  });
});

describe('buildSyslabPdfUrl', () => {
  beforeEach(() => {
    setImportMetaEnv({
      PROD: false,
      VITE_SYSLAB_API_URL: 'http://localhost:3000',
    });
    setRuntimeLocation('3000');
  });

  it('builds a proxy URL with encoded link parameter', () => {
    const link = 'http://10.4.69.90/syslab/detalleexamenes.php?id=123&user=abc';
    const result = buildSyslabPdfUrl(link);

    expect(result).toContain('/api/exams/pdf?link=');
    expect(result).toContain(encodeURIComponent(link));
  });

  it('URL-encodes special characters in the link', () => {
    const link = 'http://10.4.69.90/syslab/test?a=1&b=2';
    const result = buildSyslabPdfUrl(link);

    expect(result).not.toContain('&b=');
    expect(result).toContain(encodeURIComponent('&b=2'));
  });

  it('builds a Netlify function URL under netlify dev', () => {
    setImportMetaEnv({
      PROD: false,
      VITE_SYSLAB_API_URL: 'http://localhost:3000',
    });
    setRuntimeLocation('8888');

    const link = 'http://example.com/pdf?id=1';
    const result = buildSyslabPdfUrl(link);

    expect(result).toContain('/.netlify/functions/syslab-proxy?action=pdf&link=');
    expect(result).toContain(encodeURIComponent(link));
  });
});

describe('fetchSyslabPdfBlobUrl', () => {
  const mockFetch = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    setImportMetaEnv({
      PROD: false,
      VITE_SYSLAB_API_URL: 'http://localhost:3000',
    });
    setRuntimeLocation('3000');
    global.fetch = mockFetch;
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn(() => 'blob:syslab-pdf'),
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('requests the proxied PDF with auth headers and returns a blob URL', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      arrayBuffer: () => Promise.resolve(new Uint8Array([1, 2, 3]).buffer),
    });

    const result = await fetchSyslabPdfBlobUrl('http://example.com/pdf?id=1');

    expect(result).toBe('blob:syslab-pdf');
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/exams/pdf?link='),
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer token-123',
        }),
      })
    );
  });
});

describe('searchSyslabExams', () => {
  const mockFetch = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    setImportMetaEnv({
      PROD: false,
      VITE_SYSLAB_API_URL: 'http://localhost:3000',
    });
    setRuntimeLocation('3000');
    global.fetch = mockFetch;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('calls fetch with cleaned RUT in query parameter', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ success: true, data: [] }),
    });

    await searchSyslabExams('5.600.574-9');

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain('rut=5600574');
    expect(calledUrl).not.toContain('.');
    expect(calledUrl).not.toContain('-');
  });

  it('uses the Netlify function proxy under netlify dev', async () => {
    setImportMetaEnv({
      PROD: false,
      VITE_SYSLAB_API_URL: 'http://localhost:3000',
    });
    setRuntimeLocation('8888');
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ success: true, data: [] }),
    });

    await searchSyslabExams('5.600.574-9');

    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain('/.netlify/functions/syslab-proxy?action=search&rut=5600574');
  });

  it('returns parsed JSON on success', async () => {
    const mockData = {
      success: true,
      data: [
        {
          id: '123',
          link: null,
          date: '01/01/2026',
          time: '10:00',
          patientName: 'Test',
          origin: 'LAB',
          exams: ['HEMOGRAMA'],
        },
      ],
    };
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockData),
    });

    const result = await searchSyslabExams('12345678-9');

    expect(result.success).toBe(true);
    expect(result.data).toHaveLength(1);
    expect(result.data[0].id).toBe('123');
  });

  it('throws on non-OK HTTP response', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      json: () => Promise.resolve({ error: 'Server error' }),
    });

    await expect(searchSyslabExams('12345678')).rejects.toThrow('Server error');
  });

  it('throws on network failure', async () => {
    mockFetch.mockRejectedValue(new TypeError('Failed to fetch'));

    await expect(searchSyslabExams('12345678')).rejects.toThrow('Failed to fetch');
  });

  it('handles JSON parse failure on error response gracefully', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 502,
      json: () => Promise.reject(new Error('not json')),
    });

    await expect(searchSyslabExams('12345678')).rejects.toThrow('Error de conexión');
  });
});

describe('checkSyslabConnection', () => {
  const mockFetch = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    setImportMetaEnv({
      PROD: false,
      VITE_SYSLAB_API_URL: 'http://localhost:3000',
    });
    setRuntimeLocation('8888');
    global.fetch = mockFetch;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('returns available when the Syslab health endpoint reports connected', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ success: true, connected: true }),
    });

    await expect(checkSyslabConnection()).resolves.toEqual({
      available: true,
      message: 'Conectado',
    });
    expect(mockFetch).toHaveBeenCalledWith(
      '/.netlify/functions/syslab-proxy?action=health',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer token-123' }),
      })
    );
  });

  it('returns unavailable on network failure so the UI can disable Syslab', async () => {
    mockFetch.mockRejectedValue(new TypeError('Failed to fetch'));

    await expect(checkSyslabConnection()).resolves.toMatchObject({
      available: false,
    });
  });

  it('does not probe a cross-origin localhost Syslab proxy from plain Vite dev', async () => {
    setRuntimeLocation('3020');

    await expect(checkSyslabConnection()).resolves.toEqual({
      available: false,
      message:
        'Syslab local requiere netlify dev o VITE_SYSLAB_ENABLE_DIRECT_LOCAL=true para health checks cross-origin.',
    });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('allows explicit direct localhost health checks in plain Vite dev', async () => {
    setRuntimeLocation('3020');
    setImportMetaEnv({
      PROD: false,
      VITE_SYSLAB_API_URL: 'http://localhost:3000',
      VITE_SYSLAB_ENABLE_DIRECT_LOCAL: 'true',
    });
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ connected: true }),
    });

    await expect(checkSyslabConnection()).resolves.toEqual({
      available: true,
      message: 'Conectado',
    });
    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:3000/health',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer token-123' }),
      })
    );
  });
});

describe('fetchSyslabExamDetails', () => {
  const mockFetch = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    setImportMetaEnv({
      PROD: false,
      VITE_SYSLAB_API_URL: 'http://localhost:3000',
    });
    setRuntimeLocation('3000');
    global.fetch = mockFetch;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('sends POST with links array', async () => {
    const links = ['http://example.com/exam1', 'http://example.com/exam2'];
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ success: true, data: [] }),
    });

    await fetchSyslabExamDetails(links);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, options] = mockFetch.mock.calls[0];
    expect(url).toContain('/api/exams/details');
    expect(options.method).toBe('POST');
    expect(JSON.parse(options.body)).toEqual({ links });
  });

  it('returns parsed findings on success', async () => {
    const mockData = {
      success: true,
      data: [
        {
          url: 'http://example.com/exam1',
          findings: [
            { section: 'HG', analysis: 'HB', result: '14', unit: 'g/dL', refValue: '12-16' },
          ],
        },
      ],
    };
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockData),
    });

    const result = await fetchSyslabExamDetails(['http://example.com/exam1']);
    expect(result.success).toBe(true);
    expect(result.data[0].findings).toHaveLength(1);
  });

  it('splits large details requests into batches of three and merges results', async () => {
    const links = [
      'http://example.com/exam1',
      'http://example.com/exam2',
      'http://example.com/exam3',
      'http://example.com/exam4',
      'http://example.com/exam5',
      'http://example.com/exam6',
      'http://example.com/exam7',
    ];
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            success: true,
            data: links.slice(0, 3).map(url => ({ url, findings: [] })),
          }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            success: true,
            data: links.slice(3, 6).map(url => ({ url, findings: [] })),
          }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            success: true,
            data: links.slice(6).map(url => ({ url, findings: [] })),
          }),
      });

    const result = await fetchSyslabExamDetails(links);

    expect(mockFetch).toHaveBeenCalledTimes(3);
    expect(JSON.parse(mockFetch.mock.calls[0][1].body)).toEqual({ links: links.slice(0, 3) });
    expect(JSON.parse(mockFetch.mock.calls[1][1].body)).toEqual({ links: links.slice(3, 6) });
    expect(JSON.parse(mockFetch.mock.calls[2][1].body)).toEqual({ links: links.slice(6) });
    expect(result).toEqual({
      success: true,
      data: links.map(url => ({ url, findings: [] })),
    });
  });

  it('throws on non-OK HTTP response', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      json: () => Promise.resolve({ error: 'Internal error' }),
    });

    await expect(fetchSyslabExamDetails(['link'])).rejects.toThrow('Internal error');
  });

  it('uses the Netlify function proxy for details under netlify dev', async () => {
    setImportMetaEnv({
      PROD: false,
      VITE_SYSLAB_API_URL: 'http://localhost:3000',
    });
    setRuntimeLocation('8888');
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ success: true, data: [] }),
    });

    await fetchSyslabExamDetails(['http://example.com/exam1']);

    const [url] = mockFetch.mock.calls[0];
    expect(url).toContain('/.netlify/functions/syslab-proxy?action=details');
  });
});
