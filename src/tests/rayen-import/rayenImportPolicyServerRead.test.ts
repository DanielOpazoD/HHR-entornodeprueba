import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Timestamp, type Firestore } from 'firebase/firestore';

const session = vi.hoisted(() => ({
  headers: vi.fn(async () => ({ Authorization: 'Bearer synthetic-token' })),
}));

vi.mock('@/services/auth/authRequestHeaders', () => ({
  resolveCurrentUserAuthHeaders: session.headers,
}));

import readRayenImportPolicyFromServer from '@/features/rayen-import/settings/policyServerRead';
import {
  admitSyntheticSession,
  clearSyntheticSession,
  replaceStoredSessionOwner,
} from '@/tests/utils/syntheticSession';

const db = { app: { options: { projectId: 'demo-hhr' } } } as unknown as Firestore;
const respond = (status: number, body: unknown = {}) =>
  vi.fn(async () => new Response(JSON.stringify(body), { status }));

describe('reading the sync policy straight from the Firestore server', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    admitSyntheticSession('user:synthetic-a', 'generation-a');
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    clearSyntheticSession();
  });

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
      {
        headers: { Authorization: 'Bearer synthetic-token' },
        cache: 'no-store',
        signal: expect.any(AbortSignal),
      }
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
      admitSyntheticSession('user:synthetic-b', 'generation-b');
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
          replaceStoredSessionOwner('user:synthetic-b');
          return json();
        };
        return response;
      })
    );

    await expect(readRayenImportPolicyFromServer(db)).rejects.toMatchObject({ code: 'cancelled' });
  });
});
