import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Timestamp, type Firestore } from 'firebase/firestore';

const session = vi.hoisted(() => ({
  owner: 'user:synthetic-a',
  generation: 'generation-a',
  headers: vi.fn(async () => ({ Authorization: 'Bearer synthetic-token' })),
}));

vi.mock('@/services/auth/authRequestHeaders', () => ({
  resolveCurrentUserAuthHeaders: session.headers,
}));
vi.mock('@/services/storage/sessionOwnerKey', () => ({
  getStoredSessionOwnerKey: () => session.owner,
}));
vi.mock('@/services/storage/sessionStorageTransition', () => ({
  getSessionGeneration: () => session.generation,
}));

import readRayenImportPolicyFromServer from '@/features/rayen-import/settings/policyServerRead';

const db = { app: { options: { projectId: 'demo-hhr' } } } as unknown as Firestore;
const respond = (status: number, body: unknown = {}) =>
  vi.fn(async () => new Response(JSON.stringify(body), { status }));

describe('reading the sync policy straight from the Firestore server', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    session.owner = 'user:synthetic-a';
    session.generation = 'generation-a';
  });
  afterEach(() => vi.unstubAllGlobals());

  it('asks the server with the person’s session, bypassing every cache', async () => {
    const fetch = respond(200, {
      fields: {
        mode: { stringValue: 'preview' },
        revision: { integerValue: '7' },
        schemaVersion: { integerValue: '2' },
        updatedAt: { timestampValue: '2026-11-07T03:40:42.031787Z' },
      },
    });
    vi.stubGlobal('fetch', fetch);

    const result = await readRayenImportPolicyFromServer(db);

    expect(fetch).toHaveBeenCalledWith(
      'https://firestore.googleapis.com/v1/projects/demo-hhr/databases/(default)/documents/hospitals/hanga_roa/settings/rayenImportPolicy',
      { headers: { Authorization: 'Bearer synthetic-token' }, cache: 'no-store' }
    );
    expect(result).toMatchObject({ mode: 'preview', revision: 7, schemaVersion: 2 });
    expect(result?.updatedAt).toBeInstanceOf(Timestamp);
  });

  it('says missing only when the server answers that the document does not exist', async () => {
    vi.stubGlobal('fetch', respond(404));
    await expect(readRayenImportPolicyFromServer(db)).resolves.toBeNull();
  });

  it('turns a refused or failed read into an error, never into «missing»', async () => {
    vi.stubGlobal('fetch', respond(403));
    await expect(readRayenImportPolicyFromServer(db)).rejects.toMatchObject({
      code: 'permission-denied',
    });
    vi.stubGlobal('fetch', respond(503));
    await expect(readRayenImportPolicyFromServer(db)).rejects.toMatchObject({
      code: 'unavailable',
    });
  });

  it('discards an answer obtained with the previous person’s session', async () => {
    session.headers.mockImplementationOnce(async () => {
      // The person changes while the token is being obtained.
      session.owner = 'user:synthetic-b';
      session.generation = 'generation-b';
      return { Authorization: 'Bearer synthetic-a' };
    });
    vi.stubGlobal('fetch', respond(200, { fields: { mode: { stringValue: 'preview' } } }));

    await expect(readRayenImportPolicyFromServer(db)).rejects.toMatchObject({ code: 'cancelled' });
  });

  it('discards an answer whose body arrived after the session changed', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        const response = new Response(JSON.stringify({ fields: {} }), { status: 200 });
        const json = response.json.bind(response);
        response.json = async () => {
          session.owner = 'user:synthetic-b';
          return json();
        };
        return response;
      })
    );

    await expect(readRayenImportPolicyFromServer(db)).rejects.toMatchObject({ code: 'cancelled' });
  });
});
