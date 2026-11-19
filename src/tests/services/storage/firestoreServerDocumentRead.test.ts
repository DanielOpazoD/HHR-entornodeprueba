import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Firestore } from 'firebase/firestore';

const session = vi.hoisted(() => ({ owner: 'user:synthetic-a' }));

vi.mock('@/services/auth/authRequestHeaders', () => ({
  resolveCurrentUserAuthHeaders: async () => ({ Authorization: 'Bearer synthetic-token' }),
}));
vi.mock('@/services/storage/sessionOwnerKey', () => ({
  getStoredSessionOwnerKey: () => session.owner,
}));

import {
  readFirestoreDocumentFromServer,
  SERVER_DOCUMENT_READ_TIMEOUT_MS,
} from '@/services/storage/firestore/firestoreServerDocumentRead';

const db = { app: { options: { projectId: 'demo-hhr' } } } as unknown as Firestore;
const path = 'hospitals/hanga_roa/dailyRecords/2026-11-06';

describe('reading one Firestore document straight from the server', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    session.owner = 'user:synthetic-a';
  });

  it('asks only for the listed fields and reports an existing document without them', async () => {
    const fetch = vi.fn(async () => new Response('{"name":"x"}', { status: 200 }));
    vi.stubGlobal('fetch', fetch);

    await expect(readFirestoreDocumentFromServer(db, path, ['date'])).resolves.toEqual({});
    expect(fetch).toHaveBeenCalledWith(
      `https://firestore.googleapis.com/v1/projects/demo-hhr/databases/(default)/documents/${path}?mask.fieldPaths=date`,
      expect.objectContaining({ cache: 'no-store' })
    );
  });

  it('asks the emulator when the app runs against it', async () => {
    vi.stubEnv('DEV', true);
    vi.stubEnv('VITE_FIRESTORE_EMULATOR_HOST', '127.0.0.1:8080');
    const fetch = vi.fn(async () => new Response('{}', { status: 404 }));
    vi.stubGlobal('fetch', fetch);

    await expect(readFirestoreDocumentFromServer(db, path)).resolves.toBeNull();
    expect(fetch).toHaveBeenCalledWith(
      `http://127.0.0.1:8080/v1/projects/demo-hhr/databases/(default)/documents/${path}`,
      expect.anything()
    );
  });

  it('gives up on a request that never answers and releases it', async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: string, init: RequestInit) => {
        signal = init.signal ?? undefined;
        return new Promise<Response>(() => undefined);
      })
    );

    const read = readFirestoreDocumentFromServer(db, path, ['date']);
    const outcome = expect(read).rejects.toMatchObject({ code: 'deadline-exceeded' });
    await vi.advanceTimersByTimeAsync(SERVER_DOCUMENT_READ_TIMEOUT_MS);

    await outcome;
    expect(signal?.aborted).toBe(true);
  });

  it('reports a failure after the person changed as that change, not as a plain failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        session.owner = 'user:synthetic-b';
        throw new TypeError('Failed to fetch');
      })
    );

    await expect(readFirestoreDocumentFromServer(db, path, ['date'])).rejects.toMatchObject({
      code: 'cancelled',
    });
  });
});
