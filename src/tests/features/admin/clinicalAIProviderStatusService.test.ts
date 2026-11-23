import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getClinicalAIProviderStatuses,
  testClinicalAIProvider,
} from '@/features/admin/services/clinicalAIProviderStatusService';

vi.mock('@/services/auth/authRequestHeaders', () => ({
  resolveCurrentUserAuthHeaders: vi.fn(async () => ({ Authorization: 'Bearer synthetic' })),
}));

describe('clinicalAIProviderStatusService', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('handles non-JSON 502 gateway errors in testClinicalAIProvider without throwing raw SyntaxError', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response('<html>502 Bad Gateway</html>', {
        status: 502,
        headers: { 'Content-Type': 'text/html' },
      })
    );

    await expect(testClinicalAIProvider({ action: 'ping', provider: 'gemini' })).rejects.toThrow(
      'No se pudo probar el proveedor IA.'
    );
  });

  it('rejects non-JSON 200 status payloads cleanly', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response('not-json', {
        status: 200,
        headers: { 'Content-Type': 'text/plain' },
      })
    );

    await expect(getClinicalAIProviderStatuses()).rejects.toThrow(
      'La respuesta del estado de proveedores IA no es válida.'
    );
  });

  it('aborts stalled provider status requests after the configured timeout', async () => {
    vi.useFakeTimers();
    let capturedSignal: AbortSignal | undefined;
    vi.mocked(fetch).mockImplementationOnce(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          capturedSignal = init?.signal ?? undefined;
          capturedSignal?.addEventListener('abort', () =>
            reject(new DOMException('Aborted', 'AbortError'))
          );
        })
    );

    const pending = getClinicalAIProviderStatuses();
    const rejection = expect(pending).rejects.toThrow(
      'La consulta del estado de proveedores IA tardó demasiado en responder.'
    );
    await vi.advanceTimersByTimeAsync(10_000);
    await rejection;
    expect(capturedSignal?.aborted).toBe(true);
  });
});
