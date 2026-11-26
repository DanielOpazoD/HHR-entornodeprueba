// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { transformClinicalDocumentAiImportText } from '@/features/clinical-documents/services/clinicalDocumentAiImportService';

vi.mock('@/services/auth/authRequestHeaders', () => ({
  resolveCurrentUserAuthHeaders: vi.fn().mockResolvedValue({
    Authorization: 'Bearer token-123',
  }),
}));

const validSourceText = [
  'Informe de traslado emitido desde Hospital Hanga Roa.',
  'Paciente con antecedente explicito de hipertension arterial.',
  'Se indica continuar manejo y controles en el centro receptor.',
].join('\n');

describe('clinicalDocumentAiImportService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn();
  });

  it('returns a user-safe message when the local serverless endpoint is missing', async () => {
    vi.mocked(global.fetch).mockResolvedValue({
      ok: false,
      status: 404,
      headers: new Headers({ 'content-type': 'text/html; charset=utf-8' }),
      json: async () => {
        throw new SyntaxError('Unexpected token < in JSON');
      },
      text: async () => '<html>Not found</html>',
    } as unknown as Response);

    const result = await transformClinicalDocumentAiImportText(validSourceText);

    expect(result.status).toBe('failed');
    expect(result.userSafeMessage).toBe(
      'El endpoint local de IA no está disponible. Reinicia el servidor de desarrollo e intenta nuevamente.'
    );
  });

  it('returns a safe failure outcome when an application/json response body is truncated', async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: false,
      status: 502,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => {
        throw new SyntaxError('Unexpected end of JSON input');
      },
    } as unknown as Response);

    const result = await transformClinicalDocumentAiImportText(validSourceText);

    expect(result.status).toBe('failed');
    expect(result.userSafeMessage).toBe('No se pudo leer la respuesta del servicio de IA.');
  });
});
