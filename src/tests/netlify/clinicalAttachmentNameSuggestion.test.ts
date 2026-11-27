// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createClinicalAttachmentNameSuggestionHandler } from '../../../netlify/functions/clinical-attachment-name-suggestion';

describe('clinical-attachment-name-suggestion netlify function', () => {
  const originalEnv = { ...process.env };
  const getFirebaseServerMock = vi.fn();
  const authorizeRoleRequestMock = vi.fn();
  const extractBearerTokenMock = vi.fn();
  const resolveClinicalAIProviderConfigMock = vi.fn();
  const generateClinicalAITextMock = vi.fn();

  const handler = createClinicalAttachmentNameSuggestionHandler({
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
      provider: 'deepseek',
      apiKey: 'deepseek-key',
      model: 'deepseek-chat',
    });
    generateClinicalAITextMock.mockResolvedValue('Eco abdomen ingreso.pdf');
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('answers OPTIONS preflight for allowed origins and rejects disallowed origins', async () => {
    const allowed = await handler({
      httpMethod: 'OPTIONS',
      headers: { origin: 'https://app.example.com' },
      body: null,
    });
    const allowedHeaders = allowed.headers as Record<string, string>;
    expect(allowed.statusCode).toBe(200);
    expect(allowed.body).toBe('');
    expect(allowedHeaders['Content-Length']).toBe('0');
    expect(allowedHeaders['Access-Control-Allow-Origin']).toBe('https://app.example.com');

    const rejected = await handler({
      httpMethod: 'OPTIONS',
      headers: { origin: 'https://evil.example.com' },
      body: null,
    });
    const rejectedHeaders = rejected.headers as Record<string, string>;
    expect(rejected.statusCode).toBe(403);
    expect(rejectedHeaders['Access-Control-Allow-Origin']).toBeUndefined();
  });

  it('returns a sanitized suggested display name for authorized callers', async () => {
    const response = await handler({
      httpMethod: 'POST',
      headers: {
        authorization: 'Bearer token-123',
      },
      body: JSON.stringify({
        attachment: {
          originalFileName: 'IMG_4421.jpg',
          displayName: 'IMG_4421.jpg',
          fileKind: 'image',
          contentType: 'image/jpeg',
        },
        document: {
          documentType: 'epicrisis',
          admissionDate: '2026-04-15',
          sourceDailyRecordDate: '2026-04-15',
        },
      }),
    });

    expect(response.statusCode).toBe(200);
    expect(resolveClinicalAIProviderConfigMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'clinical_attachment_name_suggestion',
      })
    );
    expect(generateClinicalAITextMock).toHaveBeenCalledWith(
      expect.objectContaining({
        config: expect.objectContaining({ provider: 'deepseek' }),
        temperature: 0.1,
        maxTokens: 80,
      })
    );
    expect(JSON.parse(response.body)).toEqual({
      available: true,
      provider: 'deepseek',
      model: 'deepseek-chat',
      suggestedName: 'Eco abdomen ingreso.jpg',
    });
  });

  it('returns available false when no provider is configured', async () => {
    resolveClinicalAIProviderConfigMock.mockReturnValue(null);

    const response = await handler({
      httpMethod: 'POST',
      headers: {},
      body: JSON.stringify({
        attachment: {
          originalFileName: 'informe.pdf',
          displayName: 'informe.pdf',
          fileKind: 'pdf',
          contentType: 'application/pdf',
        },
      }),
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toMatchObject({
      available: false,
      message: 'AI not configured',
    });
  });
});
