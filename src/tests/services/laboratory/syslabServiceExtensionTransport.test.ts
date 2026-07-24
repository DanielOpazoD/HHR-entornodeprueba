import { beforeEach, describe, expect, it, vi } from 'vitest';

const bridgeMocks = vi.hoisted(() => ({
  status: vi.fn(),
  search: vi.fn(),
  details: vi.fn(),
  pdf: vi.fn(),
}));

vi.mock('@/services/laboratory/syslabExtensionBridge', () => ({
  cleanRutForSyslab: (rut: string) =>
    rut.replace(/\./g, '').replace(/-.*$/, '').replace(/\D/g, '').trim(),
  requestSyslabExtensionStatus: bridgeMocks.status,
  searchSyslabThroughExtension: bridgeMocks.search,
  fetchSyslabDetailsThroughExtension: bridgeMocks.details,
  openSyslabPdfThroughExtension: bridgeMocks.pdf,
  isSyslabExtensionLink: (link: string) =>
    /^hhr-syslab-extension:\/\/batch\/[0-9a-f-]{36}\/exam\/\d+$/i.test(link),
}));

vi.mock('@/services/auth/authRequestHeaders', () => ({
  resolveCurrentUserAuthHeaders: vi.fn().mockResolvedValue({ Authorization: 'Bearer test' }),
}));

vi.mock('@/services/utils/loggerScope', async () => {
  const { createLoggerScopeMock } = await import('@/tests/utils/loggerScopeMock');
  return createLoggerScopeMock();
});

import {
  checkSyslabConnection,
  fetchSyslabExamDetails,
  fetchSyslabPdfArrayBuffer,
  getSyslabBaseUrl,
  searchSyslabExams,
} from '@/services/laboratory/syslabService';

const OPAQUE_LINK =
  'hhr-syslab-extension://batch/123e4567-e89b-12d3-a456-426614174000/exam/43091284';

const setEnv = (values: Record<string, unknown>) =>
  Object.assign(import.meta.env as Record<string, unknown>, values);

describe('Syslab service extension transport', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('location', { hostname: 'localhost', port: '3000' });
    setEnv({ PROD: false, VITE_SYSLAB_API_URL: undefined });
    bridgeMocks.status.mockResolvedValue({
      bridgeAvailable: false,
      connected: false,
      loginRequired: false,
      message: 'La extensión no respondió.',
    });
    bridgeMocks.search.mockResolvedValue({ bridgeAvailable: false });
  });

  it('does not treat the HHR Vite server as the default Syslab proxy', () => {
    expect(getSyslabBaseUrl()).toBe('');
  });

  it('uses the connected extension session for the LAB health check', async () => {
    bridgeMocks.status.mockResolvedValue({
      bridgeAvailable: true,
      connected: true,
      loginRequired: false,
      message: 'Sesión de Syslab activa.',
    });
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    await expect(checkSyslabConnection()).resolves.toEqual({
      available: true,
      message: 'Conectado mediante la extensión Eloísa',
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('explains that Syslab must be connected when the extension session expired', async () => {
    bridgeMocks.status.mockResolvedValue({
      bridgeAvailable: true,
      connected: false,
      loginRequired: true,
      message: 'Syslab requiere iniciar sesión.',
    });

    await expect(checkSyslabConnection()).resolves.toEqual({
      available: false,
      message: 'Conecta Syslab desde el módulo Laboratorio de la extensión Eloísa.',
    });
  });

  it('searches through the extension and keeps only its opaque batch locator', async () => {
    bridgeMocks.search.mockResolvedValue({
      bridgeAvailable: true,
      data: {
        success: true,
        data: [
          {
            id: '43091284',
            link: OPAQUE_LINK,
            date: '21/07/2026',
            time: '13:10',
            patientName: 'Paciente Syslab',
            origin: 'HHR',
            exams: ['Hemograma'],
          },
        ],
      },
    });
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    const result = await searchSyslabExams('14.470.055-4');

    expect(result.data[0].link).toBe(OPAQUE_LINK);
    expect(bridgeMocks.search).toHaveBeenCalledWith('14.470.055-4');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('requires the extension when no explicit legacy proxy is configured', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    await expect(searchSyslabExams('14.470.055-4')).rejects.toThrow(
      'El acceso web directo a Syslab no está configurado'
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('keeps external RUN lookup on the Netlify fallback when no episode is available', async () => {
    setEnv({ PROD: true, VITE_SYSLAB_API_URL: undefined });
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ success: true, data: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    await expect(searchSyslabExams('14.470.055-4')).resolves.toEqual({
      success: true,
      data: [],
    });
    expect(fetchSpy).toHaveBeenCalledWith(
      '/.netlify/functions/syslab-proxy?action=search&rut=14470055',
      expect.any(Object)
    );
  });

  it('classifies an HTML Vite or login response instead of exposing a JSON parser error', async () => {
    setEnv({ VITE_SYSLAB_API_URL: 'http://localhost:3100' });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('<!DOCTYPE html><html><body>Vite app</body></html>', {
        status: 200,
        headers: { 'Content-Type': 'text/html' },
      })
    );

    await expect(searchSyslabExams('14.470.055-4')).rejects.toThrow(
      'Syslab respondió con una página web en vez de datos'
    );
  });

  it('turns a Syslab login page into a clear session instruction', async () => {
    setEnv({ VITE_SYSLAB_API_URL: 'http://localhost:3100' });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        '<!DOCTYPE html><html><body>Iniciar sesión · Usuario · Contraseña</body></html>',
        {
          status: 200,
          headers: { 'Content-Type': 'text/html' },
        }
      )
    );

    await expect(searchSyslabExams('14.470.055-4')).rejects.toThrow(
      'Syslab solicitó iniciar sesión'
    );
  });

  it('routes detail reads back through the same extension batch', async () => {
    bridgeMocks.details.mockResolvedValue({
      success: true,
      data: [{ url: OPAQUE_LINK, findings: [] }],
    });

    await expect(fetchSyslabExamDetails([OPAQUE_LINK])).resolves.toEqual({
      success: true,
      data: [{ url: OPAQUE_LINK, findings: [] }],
    });
    await expect(fetchSyslabPdfArrayBuffer(OPAQUE_LINK)).rejects.toThrow(
      'se abre de forma segura mediante la extensión Eloísa'
    );
    expect(bridgeMocks.details).toHaveBeenCalledWith([OPAQUE_LINK]);
  });
});
