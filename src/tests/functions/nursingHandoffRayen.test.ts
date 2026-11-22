// @vitest-environment node
import { generateKeyPairSync, sign } from 'node:crypto';
import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const {
  createRayenAssertionVerifier,
  createRayenHandoffHandler,
  createRayenNursingHandoffFunctions,
} = require('../../../functions/lib/nursingHandoffRayen.js');
const { digest } = require('../../../functions/lib/accounts/accountPolicy.js');

const issuer = 'https://issuer.example.test';
const audience = 'urn:hhr-pruebas:nursing-handoff';
const sourceOrigin = 'chrome-extension://' + 'a'.repeat(32);
const now = () => Date.parse('2026-11-20T12:00:00Z');
const seconds = now() / 1000;
const run = '11111111-1';
const uid = 'hhrn_synthetic_nurse';
const pair = generateKeyPairSync('rsa', { modulusLength: 2048 });
const otherPair = generateKeyPairSync('rsa', { modulusLength: 2048 });

function signed(
  claims: Record<string, unknown> = {},
  signer = pair.privateKey,
  header: Record<string, unknown> = {}
) {
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const unsigned =
    encode({ alg: 'RS256', typ: 'hhr-nursing-handoff+jwt', kid: 'synthetic-key', ...header }) +
    '.' +
    encode({
      iss: issuer,
      aud: audience,
      iat: seconds,
      exp: seconds + 60,
      sub: 'professional-test',
      run,
      facilityId: '1',
      ...claims,
    });
  return unsigned + '.' + sign('sha256', Buffer.from(unsigned), signer).toString('base64url');
}

const verifyAssertion = createRayenAssertionVerifier({
  issuer,
  facilityId: '1',
  keys: pair.publicKey,
  now,
});

function fixture() {
  const documents = new Map<string, unknown>([
    ['hhr_account_ruts/' + digest(run), { uid }],
    [
      'hhr_account_access/' + uid,
      { status: 'active', role: 'nurse_hospital', hospitalId: 'hanga_roa', version: 1 },
    ],
  ]);
  const getRead = vi.fn((path: string) => ({ data: () => documents.get(path) }));
  const getUser = vi.fn(async () => ({
    email: 'nurse@example.invalid',
    disabled: false,
    tokensValidAfterTime: new Date(seconds * 1000 - 1000).toISOString(),
  }));
  const firestore = {
    collection: (name: string) => ({
      doc: (id: string) => ({
        get: async () => getRead(name + '/' + id),
        collection: vi.fn(),
      }),
    }),
  };
  // createHandler opens the census collection on construction. Reads are recorded separately.
  const deps = {
    firestore,
    auth: { app: { options: { projectId: 'hhr-pruebas' } }, getUser },
    verifyAssertion,
    now,
    Timestamp: {},
    FieldValue: {},
  };
  return { deps, documents, getRead, getUser };
}

describe('credencial firmada de Eloísa para Entrega de turno', () => {
  it('devuelve exclusivamente la identidad de la credencial verificada', async () => {
    await expect(verifyAssertion(signed({ run: '11.111.111-1' }))).resolves.toEqual({
      run,
      issuedAt: now(),
    });
  });

  it('rechaza la firma, el propósito, el emisor, la audiencia, el establecimiento y la vigencia incorrectos', async () => {
    for (const token of [
      signed({}, otherPair.privateKey),
      signed({}, pair.privateKey, { typ: 'JWT' }),
      signed({}, pair.privateKey, { kid: undefined }),
      signed({ iss: 'https://otro.example.test' }),
      signed({ aud: 'urn:another-app' }),
      signed({ aud: [audience, 'urn:another-app'] }),
      signed({ facilityId: '2' }),
      signed({ run: '11111111-2' }),
      signed({ sub: '' }),
      signed({ iat: seconds - 120, exp: seconds - 1 }),
      signed({ exp: seconds + 600 }),
    ]) {
      await expect(verifyAssertion(token)).rejects.toMatchObject({ code: 'unauthenticated' });
    }
  });

  it('consulta la cuenta por el RUN firmado y bloquea estados o roles sin permiso', async () => {
    const { deps, documents, getRead, getUser } = fixture();
    const handler = createRayenHandoffHandler(deps);
    await expect(handler({ action: 'status', run })).rejects.toMatchObject({
      code: 'unauthenticated',
    });
    expect(getRead).not.toHaveBeenCalled();
    await expect(
      handler({ action: 'status', assertion: signed(), run: '22222222-2' })
    ).resolves.toEqual({
      authorized: true,
    });
    expect(getUser).toHaveBeenCalledWith(uid);

    for (const [status, role, hospitalId] of [
      ['suspended', 'nurse_hospital', 'hanga_roa'],
      ['active', 'viewer', 'hanga_roa'],
      ['active', 'nurse_hospital', 'otro_hospital'],
    ]) {
      documents.set('hhr_account_access/' + uid, { status, role, hospitalId, version: 1 });
      await expect(handler({ action: 'status', assertion: signed() })).rejects.toMatchObject({
        code: 'permission-denied',
      });
    }
  });

  it('restringe el proyecto y el origen, y valida el JWT con el JWKS configurado', async () => {
    const { deps, getUser } = fixture();
    const config = {
      GCLOUD_PROJECT: 'hhr-pruebas',
      HHR_RAYEN_HANDOFF_ISSUER: issuer,
      HHR_RAYEN_HANDOFF_JWKS_URL: issuer + '/jwks',
      HHR_RAYEN_HANDOFF_FACILITY_ID: '1',
      HHR_RAYEN_HANDOFF_EXTENSION_ORIGIN: sourceOrigin,
    };
    expect(createRayenNursingHandoffFunctions(deps, {})).toEqual({});
    expect(
      createRayenNursingHandoffFunctions(deps, { ...config, GCLOUD_PROJECT: 'other-project' })
    ).toEqual({});
    expect(
      createRayenNursingHandoffFunctions(deps, { ...config, FUNCTIONS_EMULATOR: 'true' })
    ).toEqual({});
    const { nursingHandoffRayen } = createRayenNursingHandoffFunctions(deps, config);
    expect(nursingHandoffRayen).toBeTypeOf('function');
    const res = {
      set: vi.fn().mockReturnThis(),
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
      end: vi.fn(),
    };
    const call = (req: Record<string, unknown>) =>
      nursingHandoffRayen({ headers: {}, ...req }, res);
    await call({ get: () => 'https://otro.example.test' });
    expect(res.status).toHaveBeenLastCalledWith(403);
    await call({ get: () => sourceOrigin, method: 'OPTIONS' });
    expect(res.status).toHaveBeenLastCalledWith(204);
    await call({ get: () => sourceOrigin, method: 'GET' });
    expect(res.status).toHaveBeenLastCalledWith(405);
    expect(res.json).toHaveBeenLastCalledWith({
      error: expect.objectContaining({ status: 'METHOD_NOT_ALLOWED' }),
    });
    await call({ get: () => sourceOrigin, method: 'POST', is: () => 'application/json', body: {} });
    expect(res.status).toHaveBeenLastCalledWith(400);
    await call({
      get: () => sourceOrigin,
      method: 'POST',
      is: () => 'application/json',
      body: { data: { action: 'status', run } },
    });
    expect(res.status).toHaveBeenLastCalledWith(401);
    expect(res.json).toHaveBeenLastCalledWith({
      error: expect.objectContaining({ status: 'UNAUTHENTICATED' }),
    });
    const iat = Math.floor(Date.now() / 1000);
    getUser.mockResolvedValue({
      email: 'nurse@example.invalid',
      disabled: false,
      tokensValidAfterTime: new Date((iat - 1) * 1000).toISOString(),
    });
    const request = {
      get: () => sourceOrigin,
      method: 'POST',
      is: () => 'application/json',
      body: { data: { action: 'status', assertion: signed({ iat, exp: iat + 60 }) } },
    };
    const key = { ...pair.publicKey.export({ format: 'jwk' }), kid: 'synthetic-key' };
    const fetchKeys = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(Response.json({ keys: [key] }));
    vi.stubGlobal('fetch', fetchKeys);
    try {
      await call(request);
      expect(res.status).toHaveBeenLastCalledWith(503);
      expect(res.json).toHaveBeenLastCalledWith({
        error: expect.objectContaining({ status: 'UNAVAILABLE' }),
      });
      await call(request);
      expect(res.json).toHaveBeenLastCalledWith({ result: { authorized: true } });
      expect(fetchKeys.mock.calls[1]?.[0]).toBe(config.HHR_RAYEN_HANDOFF_JWKS_URL);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
