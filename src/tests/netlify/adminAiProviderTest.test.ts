import { beforeEach, describe, expect, it, vi } from 'vitest';

const getFirebaseServerMock = vi.fn();
const authorizeRoleRequestMock = vi.fn();
const extractBearerTokenMock = vi.fn();
const resolveClinicalAIProviderConfigMock = vi.fn();
const generateClinicalAITextMock = vi.fn();

vi.mock('../../../netlify/functions/lib/firebase-server', () => ({
  getFirebaseServer: () => getFirebaseServerMock(),
}));

vi.mock('../../../netlify/functions/lib/firebase-auth', () => ({
  authorizeRoleRequest: (...args: unknown[]) => authorizeRoleRequestMock(...args),
  extractBearerToken: (...args: unknown[]) => extractBearerTokenMock(...args),
}));

vi.mock('../../../netlify/functions/lib/ai-provider', () => ({
  resolveClinicalAIProviderConfig: (...args: unknown[]) =>
    resolveClinicalAIProviderConfigMock(...args),
  generateClinicalAIText: (...args: unknown[]) => generateClinicalAITextMock(...args),
}));

import { handler } from '../../../netlify/functions/admin-ai-provider-test';

describe('admin-ai-provider-test netlify function', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.URL = 'https://app.example.com';
    getFirebaseServerMock.mockReturnValue({ db: { kind: 'firestore' } });
    extractBearerTokenMock.mockReturnValue('token-123');
    authorizeRoleRequestMock.mockResolvedValue({
      email: 'admin@hospital.cl',
      role: 'admin',
    });
    resolveClinicalAIProviderConfigMock.mockReturnValue({
      provider: 'deepseek',
      apiKey: 'deepseek-key',
      model: 'deepseek-chat',
      endpoint: 'https://api.deepseek.com/chat/completions',
    });
    generateClinicalAITextMock.mockResolvedValue('OK');
  });

  it('tests a configured provider with a non-clinical prompt for admins', async () => {
    const response = await handler({
      httpMethod: 'POST',
      headers: {
        origin: 'https://app.example.com',
        authorization: 'Bearer token-123',
      },
      body: JSON.stringify({
        action: 'clinical_document_import',
        provider: 'deepseek',
      }),
      path: '/.netlify/functions/admin-ai-provider-test',
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({
      ok: true,
      provider: 'deepseek',
      model: 'deepseek-chat',
      message: 'Provider test succeeded',
    });
    expect(authorizeRoleRequestMock).toHaveBeenCalledWith(
      { kind: 'firestore' },
      'Bearer token-123',
      new Set(['admin'])
    );
    expect(generateClinicalAITextMock).toHaveBeenCalledWith(
      expect.objectContaining({
        systemPrompt: expect.stringContaining('health check'),
        userPrompt: expect.not.stringContaining('paciente'),
      })
    );
  });

  it('returns unavailable when the selected provider has no Netlify key', async () => {
    resolveClinicalAIProviderConfigMock.mockReturnValue(null);

    const response = await handler({
      httpMethod: 'POST',
      headers: {
        origin: 'https://app.example.com',
        authorization: 'Bearer token-123',
      },
      body: JSON.stringify({
        action: 'clinical_ai_summary',
        provider: 'deepseek',
      }),
      path: '/.netlify/functions/admin-ai-provider-test',
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toMatchObject({
      ok: false,
      message: 'AI not configured',
    });
    expect(generateClinicalAITextMock).not.toHaveBeenCalled();
  });

  it('rejects non-admin callers', async () => {
    authorizeRoleRequestMock.mockRejectedValue(
      new Error("Access denied for role 'nurse_hospital'.")
    );

    const response = await handler({
      httpMethod: 'POST',
      headers: {
        origin: 'https://app.example.com',
        authorization: 'Bearer token-123',
      },
      body: JSON.stringify({
        action: 'cie10_search',
        provider: 'gemini',
      }),
      path: '/.netlify/functions/admin-ai-provider-test',
    });

    expect(response.statusCode).toBe(403);
    expect(generateClinicalAITextMock).not.toHaveBeenCalled();
  });
});
