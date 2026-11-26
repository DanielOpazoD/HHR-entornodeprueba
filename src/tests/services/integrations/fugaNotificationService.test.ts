// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { sendFugaNotification } from '@/features/census/services/fugaNotificationService';

const resolveCurrentUserAuthHeadersMock = vi.fn();

vi.mock('@/services/auth/authRequestHeaders', () => ({
  resolveCurrentUserAuthHeaders: () => resolveCurrentUserAuthHeadersMock(),
}));

describe('fugaNotificationService', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    resolveCurrentUserAuthHeadersMock.mockResolvedValue({
      Authorization: 'Bearer token-123',
    });
    vi.stubGlobal('fetch', vi.fn());
  });

  it('parses valid notification responses', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true, message: 'ok', gmailId: 'gmail-1' }),
    } as Response);

    await expect(
      sendFugaNotification({
        patientName: 'Paciente Test',
        rut: '11.111.111-1',
        diagnosis: 'Diagnóstico',
        bedName: 'Cama 1',
        recordDate: '2026-03-31',
        time: '14:30',
        automaticMessage: 'Mensaje',
      })
    ).resolves.toEqual({ success: true, message: 'ok', gmailId: 'gmail-1' });
  });

  it('rejects malformed notification responses', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true, message: 'ok' }),
    } as Response);

    await expect(
      sendFugaNotification({
        patientName: 'Paciente Test',
        rut: '11.111.111-1',
        diagnosis: 'Diagnóstico',
        bedName: 'Cama 1',
        recordDate: '2026-03-31',
        time: '14:30',
        automaticMessage: 'Mensaje',
      })
    ).rejects.toThrow();
  });

  it('throws a clear Spanish error when an OK response contains non-JSON body', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response('<html>unexpected</html>', { status: 200 })
    );

    await expect(
      sendFugaNotification({
        patientName: 'Paciente Test',
        rut: '11.111.111-1',
        diagnosis: 'Diagnóstico',
        bedName: 'Cama 1',
        recordDate: '2026-03-31',
        time: '14:30',
        automaticMessage: 'Mensaje',
      })
    ).rejects.toThrow('La respuesta del servicio de notificación no es válida.');
  });
});
