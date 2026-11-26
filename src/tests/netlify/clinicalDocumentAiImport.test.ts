// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createClinicalDocumentAiImportHandler } from '../../../netlify/functions/clinical-document-ai-import';

describe('clinical-document-ai-import netlify function', () => {
  const originalEnv = { ...process.env };
  const getFirebaseServerMock = vi.fn();
  const authorizeRoleRequestMock = vi.fn();
  const extractBearerTokenMock = vi.fn();
  const resolveClinicalAIProviderConfigMock = vi.fn();
  const generateClinicalAITextMock = vi.fn();

  const handler = createClinicalDocumentAiImportHandler({
    getFirebaseServer: getFirebaseServerMock as typeof getFirebaseServerMock,
    authorizeRoleRequest: authorizeRoleRequestMock as typeof authorizeRoleRequestMock,
    extractBearerToken: extractBearerTokenMock as typeof extractBearerTokenMock,
    resolveClinicalAIProviderConfig:
      resolveClinicalAIProviderConfigMock as typeof resolveClinicalAIProviderConfigMock,
    generateClinicalAIText: generateClinicalAITextMock as typeof generateClinicalAITextMock,
  });

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = {
      ...originalEnv,
      URL: 'https://app.example.com',
    };
    getFirebaseServerMock.mockReturnValue({ db: { kind: 'firestore' } });
    extractBearerTokenMock.mockReturnValue('token-123');
    authorizeRoleRequestMock.mockResolvedValue({
      email: 'doctor@hospital.cl',
      role: 'doctor_urgency',
    });
    resolveClinicalAIProviderConfigMock.mockReturnValue({
      provider: 'openai',
      apiKey: 'openai-key',
      model: 'gpt-4o-mini',
    });
    generateClinicalAITextMock.mockResolvedValue(
      JSON.stringify({
        antecedentes: 'HTA.',
        historiaEvolucionClinica: 'Informe de traslado por neumonia.',
        examenesComplementarios: 'Radiografia de torax compatible.',
        diagnosticosEgreso: 'Neumonia.',
        planEgreso: 'Continuar manejo antibiotico en centro receptor.',
      })
    );
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('returns available false when no provider is configured', async () => {
    resolveClinicalAIProviderConfigMock.mockReturnValue(null);

    const response = await handler({
      httpMethod: 'POST',
      headers: {},
      body: JSON.stringify({ sourceText: 'Informe de traslado. '.repeat(10) }),
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toMatchObject({
      available: false,
      message: 'AI not configured',
    });
  });

  it('returns 400 when source text is missing or too short', async () => {
    const response = await handler({
      httpMethod: 'POST',
      headers: {
        authorization: 'Bearer token-123',
      },
      body: JSON.stringify({ sourceText: 'breve' }),
    });

    expect(response.statusCode).toBe(400);
    expect(response.body).toContain('texto clinico extraido');
  });

  it('returns simplified clinical document JSON for authorized callers', async () => {
    const response = await handler({
      httpMethod: 'POST',
      headers: {
        authorization: 'Bearer token-123',
      },
      body: JSON.stringify({ sourceText: 'Informe de traslado. '.repeat(10) }),
    });

    expect(response.statusCode).toBe(200);
    expect(authorizeRoleRequestMock).toHaveBeenCalledWith(
      { kind: 'firestore' },
      'Bearer token-123',
      expect.any(Set)
    );
    expect(generateClinicalAITextMock).toHaveBeenCalledWith(
      expect.objectContaining({
        config: expect.objectContaining({ provider: 'openai' }),
        temperature: 0.1,
      })
    );
    expect(JSON.parse(response.body)).toEqual({
      available: true,
      provider: 'openai',
      model: 'gpt-4o-mini',
      document: {
        antecedentes: 'HTA.',
        historiaEvolucionClinica: 'Informe de traslado por neumonia.',
        examenesComplementarios: 'Radiografia de torax compatible.',
        diagnosticosEgreso: 'Neumonia.',
        planEgreso: 'Continuar manejo antibiotico en centro receptor.',
      },
    });
  });

  it('sends sanitized source text to AI without administrative patient identifiers', async () => {
    const response = await handler({
      httpMethod: 'POST',
      headers: {
        authorization: 'Bearer token-123',
      },
      body: JSON.stringify({
        sourceText: [
          'Nombre completo: Juan Perez Hanga',
          'Paciente: Maria Rapa Nui',
          'RUT: 12.345.678-9',
          'Ficha: 445566',
          'Traslado por neumonia adquirida en la comunidad.',
          'Tratamiento con ceftriaxona 1 g cada 24 horas.',
          'Continuar manejo en centro receptor.',
        ].join('\n'),
      }),
    });

    expect(response.statusCode).toBe(200);
    const aiCall = generateClinicalAITextMock.mock.calls.at(-1)?.[0];
    expect(aiCall?.userPrompt).not.toContain('Juan Perez Hanga');
    expect(aiCall?.userPrompt).not.toContain('Maria Rapa Nui');
    expect(aiCall?.userPrompt).not.toContain('12.345.678-9');
    expect(aiCall?.userPrompt).not.toContain('445566');
    expect(aiCall?.userPrompt).toContain('Traslado por neumonia adquirida en la comunidad.');
    expect(aiCall?.userPrompt).toContain('Tratamiento con ceftriaxona 1 g cada 24 horas.');
  });

  it('returns 502 when the AI response is not valid import JSON', async () => {
    generateClinicalAITextMock.mockResolvedValue('no-json');

    const response = await handler({
      httpMethod: 'POST',
      headers: {
        authorization: 'Bearer token-123',
      },
      body: JSON.stringify({ sourceText: 'Informe de traslado. '.repeat(10) }),
    });

    expect(response.statusCode).toBe(502);
    expect(response.body).toContain('respuesta IA');
  });
});
