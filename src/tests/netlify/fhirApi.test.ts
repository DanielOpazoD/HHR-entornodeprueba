import { createProviderError, credentialMarkers } from './providerErrorFixture';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const getDocMock = vi.fn();
const getDocsMock = vi.fn();
const docMock = vi.fn();
const collectionMock = vi.fn();
const queryMock = vi.fn();
const whereMock = vi.fn();
const getFirebaseServerMock = vi.fn();
const mapMasterPatientToFhirMock = vi.fn();
const mapEncounterToFhirMock = vi.fn();
const authorizeFhirRequestMock = vi.fn();
const extractBearerTokenMock = vi.fn();

vi.mock('firebase/firestore', () => ({
  doc: (...args: unknown[]) => docMock(...args),
  getDoc: (...args: unknown[]) => getDocMock(...args),
  collection: (...args: unknown[]) => collectionMock(...args),
  query: (...args: unknown[]) => queryMock(...args),
  where: (...args: unknown[]) => whereMock(...args),
  getDocs: (...args: unknown[]) => getDocsMock(...args),
}));

vi.mock('../../../netlify/functions/lib/firebase-server', () => ({
  getFirebaseServer: () => getFirebaseServerMock(),
}));

vi.mock('../../../src/services/utils/fhirMappers', () => ({
  mapMasterPatientToFhir: (...args: unknown[]) => mapMasterPatientToFhirMock(...args),
  mapEncounterToFhir: (...args: unknown[]) => mapEncounterToFhirMock(...args),
}));

vi.mock('../../../netlify/functions/lib/firebase-auth', () => ({
  authorizeRoleRequest: (...args: unknown[]) => authorizeFhirRequestMock(...args),
  extractBearerToken: (...args: unknown[]) => extractBearerTokenMock(...args),
}));

import { createFhirApiHandler } from '../../../netlify/functions/fhir-api';

describe('fhir-api netlify function', () => {
  it('redacts provider failures in the FHIR response and logs', async () => {
    const logs = vi.spyOn(console, 'error').mockImplementation(() => {});
    getFirebaseServerMock.mockImplementationOnce(() => {
      throw createProviderError();
    });
    try {
      const result = await handler({ httpMethod: 'GET', headers: {}, body: null });
      expect(result.statusCode).toBe(500);
      expect(JSON.parse(result.body).issue[0].diagnostics).toContain('HTTP 503');
      const outputs =
        result.body +
        logs.mock.calls.map(call => call.map(String).join(' ')).join(' ') +
        JSON.stringify(logs.mock.calls);
      for (const marker of credentialMarkers) expect(outputs).not.toContain(marker);
    } finally {
      logs.mockRestore();
    }
  });
  const originalEnv = { ...process.env };
  const handler = createFhirApiHandler({
    getFirebaseServer: getFirebaseServerMock as typeof getFirebaseServerMock,
    authorizeRoleRequest: authorizeFhirRequestMock as typeof authorizeFhirRequestMock,
    extractBearerToken: extractBearerTokenMock as typeof extractBearerTokenMock,
    getDoc: getDocMock as typeof getDocMock,
    getDocs: getDocsMock as typeof getDocsMock,
    doc: docMock as typeof docMock,
    collection: collectionMock as typeof collectionMock,
    query: queryMock as typeof queryMock,
    where: whereMock as typeof whereMock,
    mapMasterPatientToFhir: mapMasterPatientToFhirMock as typeof mapMasterPatientToFhirMock,
    mapEncounterToFhir: mapEncounterToFhirMock as typeof mapEncounterToFhirMock,
  });

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = {
      ...originalEnv,
      URL: 'https://app.example.com',
      DEPLOY_PRIME_URL: '',
      DEPLOY_URL: '',
      SITE_URL: '',
      APP_URL: '',
    };

    getFirebaseServerMock.mockReturnValue({ db: { kind: 'firestore' } });
    docMock.mockReturnValue({ id: 'doc-ref' });
    collectionMock.mockReturnValue({ id: 'collection-ref' });
    whereMock.mockReturnValue({ id: 'where-ref' });
    queryMock.mockReturnValue({ id: 'query-ref' });
    mapMasterPatientToFhirMock.mockImplementation(data => ({
      resourceType: 'Patient',
      id: data.rut ?? 'patient-1',
    }));
    mapEncounterToFhirMock.mockImplementation(() => ({
      resourceType: 'Encounter',
      id: 'encounter-1',
    }));
    extractBearerTokenMock.mockReturnValue('token-123');
    authorizeFhirRequestMock.mockResolvedValue({
      email: 'clinician@hospital.cl',
      role: 'doctor_urgency',
      token: { sub: 'uid-1' },
    });
  });

  it('answers trusted preflight requests with reflected CORS headers', async () => {
    const response = await handler({
      httpMethod: 'OPTIONS',
      headers: { origin: 'https://app.example.com' },
      body: null,
      path: '/.netlify/functions/fhir-api/metadata',
    });
    const headers = response.headers as Record<string, string>;

    expect(response.statusCode).toBe(200);
    expect(headers['Access-Control-Allow-Origin']).toBe('https://app.example.com');
    expect(headers['Access-Control-Allow-Methods']).toBe('GET,OPTIONS');
  });

  it('rejects untrusted browser origins', async () => {
    const response = await handler({
      httpMethod: 'GET',
      headers: { origin: 'https://evil.example.com' },
      body: null,
      path: '/.netlify/functions/fhir-api/metadata',
    });

    expect(response.statusCode).toBe(403);
    expect(response.body).toContain('Origin not allowed');
    expect(getFirebaseServerMock).not.toHaveBeenCalled();
  });

  it('returns a capability statement for metadata requests', async () => {
    const response = await handler({
      httpMethod: 'GET',
      headers: {
        origin: 'https://app.example.com',
        authorization: 'Bearer token-123',
      },
      body: null,
      path: '/.netlify/functions/fhir-api/metadata',
    });
    const headers = response.headers as Record<string, string>;

    expect(response.statusCode).toBe(200);
    expect(headers['Content-Type']).toBe('application/fhir+json');
    expect(JSON.parse(response.body)).toEqual(
      expect.objectContaining({
        resourceType: 'CapabilityStatement',
      })
    );
  });

  it('returns 401 when the request has no bearer token', async () => {
    extractBearerTokenMock.mockImplementation(() => {
      throw new Error('Missing Authorization bearer token.');
    });

    const response = await handler({
      httpMethod: 'GET',
      headers: { origin: 'https://app.example.com' },
      body: null,
      path: '/.netlify/functions/fhir-api/metadata',
    });

    expect(response.statusCode).toBe(401);
    expect(JSON.parse(response.body)).toEqual(
      expect.objectContaining({
        resourceType: 'OperationOutcome',
        issue: [expect.objectContaining({ code: 'login' })],
      })
    );
    expect(authorizeFhirRequestMock).not.toHaveBeenCalled();
  });

  it('returns 403 when the authenticated user role cannot access FHIR', async () => {
    authorizeFhirRequestMock.mockRejectedValue(new Error("Access denied for role 'viewer'."));

    const response = await handler({
      httpMethod: 'GET',
      headers: {
        origin: 'https://app.example.com',
        authorization: 'Bearer token-123',
      },
      body: null,
      path: '/.netlify/functions/fhir-api/metadata',
    });

    expect(response.statusCode).toBe(403);
    expect(JSON.parse(response.body)).toEqual(
      expect.objectContaining({
        resourceType: 'OperationOutcome',
        issue: [expect.objectContaining({ code: 'forbidden' })],
      })
    );
  });

  it('reads patient resources from the primary document path', async () => {
    getDocMock.mockResolvedValue({
      exists: () => true,
      data: () => ({ rut: '12345678-9' }),
    });

    const response = await handler({
      httpMethod: 'GET',
      headers: {
        origin: 'https://app.example.com',
        authorization: 'Bearer token-123',
      },
      body: null,
      path: '/.netlify/functions/fhir-api/Patient/12345678-9',
    });

    expect(docMock).toHaveBeenCalledWith(
      { kind: 'firestore' },
      'hospitals/hanga_roa/patients',
      '12345678-9'
    );
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({
      resourceType: 'Patient',
      id: '12345678-9',
    });
  });

  it('returns operation outcome payloads for missing patient ids', async () => {
    const response = await handler({
      httpMethod: 'GET',
      headers: {
        origin: 'https://app.example.com',
        authorization: 'Bearer token-123',
      },
      body: null,
      path: '/.netlify/functions/fhir-api/Patient',
    });

    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body)).toEqual(
      expect.objectContaining({
        resourceType: 'OperationOutcome',
        issue: [expect.objectContaining({ code: 'required' })],
      })
    );
  });

  it('returns 400 for invalid encounter ids before touching firestore', async () => {
    const response = await handler({
      httpMethod: 'GET',
      headers: {
        origin: 'https://app.example.com',
        authorization: 'Bearer token-123',
      },
      body: null,
      path: '/.netlify/functions/fhir-api/Encounter/bad-id',
    });

    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body)).toEqual(
      expect.objectContaining({
        resourceType: 'OperationOutcome',
        issue: [expect.objectContaining({ code: 'invalid' })],
      })
    );
    expect(docMock).not.toHaveBeenCalled();
  });

  it('returns 404 operation outcomes for unsupported resources', async () => {
    const response = await handler({
      httpMethod: 'GET',
      headers: {
        origin: 'https://app.example.com',
        authorization: 'Bearer token-123',
      },
      body: null,
      path: '/.netlify/functions/fhir-api/Observation/obs-1',
    });

    expect(response.statusCode).toBe(404);
    expect(JSON.parse(response.body)).toEqual(
      expect.objectContaining({
        resourceType: 'OperationOutcome',
        issue: [expect.objectContaining({ code: 'not-found' })],
      })
    );
  });

  it('falls back to query by rut when the patient document id does not match', async () => {
    getDocMock.mockResolvedValue({
      exists: () => false,
    });
    getDocsMock.mockResolvedValue({
      empty: false,
      docs: [
        {
          data: () => ({ rut: '12345678-9' }),
        },
      ],
    });

    const response = await handler({
      httpMethod: 'GET',
      headers: {
        origin: 'https://app.example.com',
        authorization: 'Bearer token-123',
      },
      body: null,
      path: '/.netlify/functions/fhir-api/Patient/12345678-9',
    });

    expect(queryMock).toHaveBeenCalled();
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({
      resourceType: 'Patient',
      id: '12345678-9',
    });
  });
});
