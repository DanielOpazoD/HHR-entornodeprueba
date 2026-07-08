import { beforeEach, describe, expect, it, vi } from 'vitest';

const generateContentMock = vi.fn();
const getFirebaseServerMock = vi.fn();
const authorizeRoleRequestMock = vi.fn();
const extractBearerTokenMock = vi.fn();

vi.mock('@google/genai', () => ({
  GoogleGenAI: class {
    models = {
      generateContent: (...args: unknown[]) => generateContentMock(...args),
    };
  },
}));

vi.mock('../../../netlify/functions/lib/firebase-server', () => ({
  getFirebaseServer: () => getFirebaseServerMock(),
}));

vi.mock('../../../netlify/functions/lib/firebase-auth', () => ({
  authorizeRoleRequest: (...args: unknown[]) => authorizeRoleRequestMock(...args),
  extractBearerToken: (...args: unknown[]) => extractBearerTokenMock(...args),
}));

vi.mock('../../../netlify/functions/lib/ai-provider-routing', () => ({
  loadClinicalAIRoutingConfigFromFirestore: vi.fn().mockResolvedValue(null),
}));

import { handler } from '../../../netlify/functions/cie10-ai-search';

describe('cie10-ai-search netlify function', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = {
      ...originalEnv,
      URL: 'https://app.example.com',
      GEMINI_API_KEY: 'gemini-key',
    };

    getFirebaseServerMock.mockReturnValue({ db: { kind: 'firestore' } });
    extractBearerTokenMock.mockReturnValue('token-123');
    authorizeRoleRequestMock.mockResolvedValue({
      email: 'doctor@hospital.cl',
      role: 'doctor_urgency',
      token: { sub: 'uid-1' },
    });
    generateContentMock.mockResolvedValue({
      text: JSON.stringify([
        { code: 'J18.9', description: 'Neumonía, no especificada', category: 'Respiratorias' },
      ]),
    });
  });

  it('accepts trusted preflight requests', async () => {
    const response = await handler({
      httpMethod: 'OPTIONS',
      headers: { origin: 'https://app.example.com' },
      body: null,
      path: '/.netlify/functions/cie10-ai-search',
    });
    const headers = response.headers as Record<string, string>;

    expect(response.statusCode).toBe(200);
    expect(headers['Access-Control-Allow-Origin']).toBe('https://app.example.com');
  });

  it('does not consume rate limit quota on trusted preflight requests', async () => {
    for (let i = 0; i < 10; i++) {
      const preflight = await handler({
        httpMethod: 'OPTIONS',
        headers: {
          origin: 'https://app.example.com',
          'x-nf-client-connection-ip': '198.51.100.10',
        },
        body: null,
        path: '/.netlify/functions/cie10-ai-search',
      });

      expect(preflight.statusCode).toBe(200);
    }

    const response = await handler({
      httpMethod: 'POST',
      headers: {
        origin: 'https://app.example.com',
        authorization: 'Bearer token-123',
        'x-nf-client-connection-ip': '198.51.100.10',
      },
      body: JSON.stringify({ query: 'neumonia' }),
      path: '/.netlify/functions/cie10-ai-search',
    });

    expect(response.statusCode).toBe(200);
  });

  it('returns 401 when the caller has no bearer token', async () => {
    extractBearerTokenMock.mockImplementation(() => {
      throw new Error('Missing Authorization bearer token.');
    });

    const response = await handler({
      httpMethod: 'POST',
      headers: { origin: 'https://app.example.com' },
      body: JSON.stringify({ query: 'neumonia' }),
      path: '/.netlify/functions/cie10-ai-search',
    });

    expect(response.statusCode).toBe(401);
    expect(response.body).toContain('Missing Authorization bearer token');
  });

  it('returns 403 when the role is not allowed to use AI search', async () => {
    authorizeRoleRequestMock.mockRejectedValue(new Error("Access denied for role 'unauthorized'."));

    const response = await handler({
      httpMethod: 'POST',
      headers: {
        origin: 'https://app.example.com',
        authorization: 'Bearer token-123',
      },
      body: JSON.stringify({ query: 'neumonia' }),
      path: '/.netlify/functions/cie10-ai-search',
    });

    expect(response.statusCode).toBe(403);
    expect(response.body).toContain("Access denied for role 'unauthorized'");
    expect(generateContentMock).not.toHaveBeenCalled();
  });

  it('returns AI-coded results for authorized requests', async () => {
    const response = await handler({
      httpMethod: 'POST',
      headers: {
        origin: 'https://app.example.com',
        authorization: 'Bearer token-123',
      },
      body: JSON.stringify({ query: 'neumonia' }),
      path: '/.netlify/functions/cie10-ai-search',
    });

    expect(response.statusCode).toBe(200);
    expect(generateContentMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse(response.body)).toEqual({
      available: true,
      results: [
        {
          code: 'J18.9',
          description: 'Neumonía, no especificada',
          category: 'Respiratorias',
        },
      ],
    });
  });
});
