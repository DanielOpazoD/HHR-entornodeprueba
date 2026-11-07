import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Firestore } from 'firebase/firestore';

vi.mock('@/services/auth/authRequestHeaders', () => ({
  resolveCurrentUserAuthHeaders: async () => ({ Authorization: 'Bearer synthetic-token' }),
}));

import { readFirestoreDocumentFromServer } from '@/services/storage/firestore/firestoreServerDocumentRead';

const db = { app: { options: { projectId: 'demo-hhr' } } } as unknown as Firestore;
const path = 'hospitals/hanga_roa/dailyRecords/2026-11-06';

describe('reading one Firestore document straight from the server', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
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
});
