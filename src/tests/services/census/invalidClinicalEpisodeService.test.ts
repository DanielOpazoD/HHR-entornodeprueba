// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FirebaseConfigRuntimeAdapter } from '@/services/firebase-runtime/firebaseConfigRuntimeAdapter';

const firestore = vi.hoisted(() => ({
  doc: vi.fn((_db: unknown, path: string, id: string) => ({ path: `${path}/${id}` })),
  setDoc: vi.fn(),
  getDocFromServer: vi.fn(),
  serverTimestamp: vi.fn(() => 'SERVER_TIME'),
  collection: vi.fn(),
  getDocsFromServer: vi.fn(),
}));
vi.mock('firebase/firestore', async importOriginal => ({
  ...(await importOriginal<typeof import('firebase/firestore')>()),
  ...firestore,
}));

import { markClinicalEpisodeInvalid } from '@/services/census/invalidClinicalEpisodeService';

const adapter = (uid: string | null = 'user_nurse') =>
  ({
    readyFirestore: Promise.resolve(),
    getDb: () => ({}),
    getAuth: () => ({ currentUser: uid ? { uid } : null }),
  }) as unknown as FirebaseConfigRuntimeAdapter;

const mark = { clinicalEpisodeId: ' 900200 ', censusDate: '2026-11-05', bedId: 'NEO1' };

describe('markClinicalEpisodeInvalid', () => {
  beforeEach(() => vi.clearAllMocks());

  it('writes the mark signed by the session user with the server clock', async () => {
    firestore.setDoc.mockResolvedValue(undefined);

    await markClinicalEpisodeInvalid(mark, adapter());

    expect(firestore.setDoc).toHaveBeenCalledWith(
      { path: expect.stringMatching(/\/invalidClinicalEpisodes\/900200$/) },
      {
        clinicalEpisodeId: '900200',
        censusDate: '2026-11-05',
        bedId: 'NEO1',
        markedAt: 'SERVER_TIME',
        markedBy: 'user_nurse',
      }
    );
  });

  it('accepts a mark another editor already saved, since marks never change', async () => {
    firestore.setDoc.mockRejectedValue(new Error('permission-denied'));
    firestore.getDocFromServer.mockResolvedValue({ exists: () => true });

    await expect(markClinicalEpisodeInvalid(mark, adapter())).resolves.toBeUndefined();
  });

  it('fails when the server never confirms the mark', async () => {
    firestore.setDoc.mockReturnValue(new Promise(() => undefined));
    firestore.getDocFromServer.mockRejectedValue(new Error('offline'));

    await expect(markClinicalEpisodeInvalid(mark, adapter(), 5)).rejects.toThrow(
      'No se pudo confirmar la marca en el servidor.'
    );
  });

  it('fails without a session or an episode, before writing anything', async () => {
    await expect(markClinicalEpisodeInvalid(mark, adapter(null))).rejects.toThrow();
    await expect(
      markClinicalEpisodeInvalid({ ...mark, clinicalEpisodeId: ' ' }, adapter())
    ).rejects.toThrow();
    expect(firestore.setDoc).not.toHaveBeenCalled();
  });
});
