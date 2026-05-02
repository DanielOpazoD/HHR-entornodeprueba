import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSign, generateKeyPairSync } from 'node:crypto';
import { restoreConsole, suppressConsole } from '@/tests/utils/consoleTestUtils';

const docMock = vi.fn();
const getDocMock = vi.fn();
vi.mock('firebase/firestore', () => ({
  doc: (...args: unknown[]) => docMock(...args),
  getDoc: (...args: unknown[]) => getDocMock(...args),
}));

import {
  authorizeRoleRequest,
  extractBearerToken,
  resetFirebaseSigningKeyCacheForTests,
  resolveRoleForEmail,
  verifyFirebaseIdToken,
} from '../../../netlify/functions/lib/firebase-auth';

const base64UrlEncode = (value: string | Buffer) =>
  Buffer.from(value).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');

describe('firebase-auth netlify helper', () => {
  const originalEnv = { ...process.env };
  const originalFetch = global.fetch;
  const fixedNow = new Date('2026-03-26T12:00:00.000Z');
  const { privateKey, publicKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(fixedNow);
    resetFirebaseSigningKeyCacheForTests();
    process.env = {
      ...originalEnv,
      VITE_FIREBASE_PROJECT_ID: 'hhr-pruebas',
    };

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        'test-kid': publicKey.export({ type: 'pkcs1', format: 'pem' }).toString(),
      }),
      headers: new Headers({
        'cache-control': 'public, max-age=3600, must-revalidate, no-transform',
      }),
    }) as typeof fetch;

    docMock.mockReturnValue({ id: 'config-roles-ref' });
    getDocMock.mockResolvedValue({
      exists: () => true,
      data: () => ({
        'doctor@hospital.cl': 'doctor_urgency',
      }),
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    process.env = originalEnv;
    global.fetch = originalFetch;
  });

  const createToken = (payloadOverrides: Record<string, unknown> = {}) => {
    const nowSeconds = Math.floor(Date.now() / 1000);
    const header = base64UrlEncode(
      JSON.stringify({
        alg: 'RS256',
        kid: 'test-kid',
        typ: 'JWT',
      })
    );
    const payload = base64UrlEncode(
      JSON.stringify({
        aud: 'hhr-pruebas',
        iss: 'https://securetoken.google.com/hhr-pruebas',
        sub: 'uid-123',
        email: 'doctor@hospital.cl',
        iat: nowSeconds - 60,
        exp: nowSeconds + 3600,
        ...payloadOverrides,
      })
    );
    const signingInput = `${header}.${payload}`;
    const signer = createSign('RSA-SHA256');
    signer.update(signingInput);
    signer.end();
    const signature = signer.sign(privateKey);

    return `${signingInput}.${base64UrlEncode(signature)}`;
  };

  const mockCanonicalRoleLookup = (role: string, status = 200) => {
    vi.mocked(global.fetch)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          'test-kid': publicKey.export({ type: 'pkcs1', format: 'pem' }).toString(),
        }),
        headers: new Headers({
          'cache-control': 'public, max-age=3600, must-revalidate, no-transform',
        }),
      } as Response)
      .mockResolvedValueOnce({
        ok: status >= 200 && status < 300,
        status,
        json: async () => ({ result: { role } }),
        headers: new Headers(),
      } as Response);
  };

  it('extracts bearer tokens from the authorization header', () => {
    expect(extractBearerToken('Bearer abc.123')).toBe('abc.123');
    expect(() => extractBearerToken(undefined)).toThrow('Missing Authorization bearer token');
    expect(() => extractBearerToken('Basic abc.123')).toThrow(
      'Authorization header must use Bearer token'
    );
  });

  it('verifies Firebase ID tokens against project, issuer and signature', async () => {
    const payload = await verifyFirebaseIdToken(createToken());

    expect(payload.sub).toBe('uid-123');
    expect(payload.email).toBe('doctor@hospital.cl');
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('rejects tokens signed for another Firebase project', async () => {
    await expect(
      verifyFirebaseIdToken(
        createToken({
          aud: 'other-project',
          iss: 'https://securetoken.google.com/other-project',
        })
      )
    ).rejects.toThrow('Invalid Firebase token audience');
  });

  it('rejects expired Firebase ID tokens', async () => {
    await expect(
      verifyFirebaseIdToken(
        createToken({
          iat: Math.floor(Date.now() / 1000) - 7200,
          exp: Math.floor(Date.now() / 1000) - 3600,
        })
      )
    ).rejects.toThrow('Expired Firebase token');
  });

  it('rejects tokens with an unexpected issuer', async () => {
    await expect(
      verifyFirebaseIdToken(
        createToken({
          iss: 'https://securetoken.google.com/otro-proyecto',
        })
      )
    ).rejects.toThrow('Invalid Firebase token issuer');
  });

  it('authorizes allowed roles resolved from config/roles', async () => {
    mockCanonicalRoleLookup('doctor_urgency');

    const result = await authorizeRoleRequest(
      { kind: 'firestore' } as never,
      `Bearer ${createToken()}`,
      new Set(['doctor_urgency'])
    );

    expect(result).toEqual(
      expect.objectContaining({
        email: 'doctor@hospital.cl',
        role: 'doctor_urgency',
      })
    );
    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(vi.mocked(global.fetch).mock.calls[1]?.[0]).toBe(
      'https://us-central1-hhr-pruebas.cloudfunctions.net/checkUserRole'
    );
  });

  it('normalizes legacy role aliases without mutating config/roles during authorization', async () => {
    getDocMock.mockResolvedValue({
      exists: () => true,
      data: () => ({
        'doctor@hospital.cl': 'viewer_census',
      }),
    });

    await expect(
      resolveRoleForEmail({ kind: 'firestore' } as never, 'doctor@hospital.cl')
    ).resolves.toBe('viewer');
  });

  it('rejects authenticated users with roles outside the allowed set', async () => {
    mockCanonicalRoleLookup('doctor_urgency');

    await expect(
      authorizeRoleRequest(
        { kind: 'firestore' } as never,
        `Bearer ${createToken()}`,
        new Set(['admin'])
      )
    ).rejects.toThrow("Access denied for role 'doctor_urgency'");
  });

  it('does not degrade shell-authorized admins to unauthorized inside netlify auth', async () => {
    mockCanonicalRoleLookup('admin');

    await expect(
      authorizeRoleRequest(
        { kind: 'firestore' } as never,
        `Bearer ${createToken({ email: 'daniel.opazo@hospitalhangaroa.cl' })}`,
        new Set(['admin', 'viewer'])
      )
    ).resolves.toEqual(
      expect.objectContaining({
        email: 'daniel.opazo@hospitalhangaroa.cl',
        role: 'admin',
      })
    );
  });

  it('throws when the canonical callable role lookup is unavailable', async () => {
    const consoleSpies = suppressConsole(['warn']);
    vi.mocked(global.fetch)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          'test-kid': publicKey.export({ type: 'pkcs1', format: 'pem' }).toString(),
        }),
        headers: new Headers({
          'cache-control': 'public, max-age=3600, must-revalidate, no-transform',
        }),
      } as Response)
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: async () => ({
          error: { message: 'canonical backend down' },
        }),
        headers: new Headers(),
      } as Response);

    try {
      await expect(
        authorizeRoleRequest(
          { kind: 'firestore' } as never,
          `Bearer ${createToken()}`,
          new Set(['doctor_urgency'])
        )
      ).rejects.toThrow('canonical backend down');
    } finally {
      restoreConsole(consoleSpies);
    }
  });
});
