import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FirestoreServiceRuntimePort } from '@/services/storage/firestore/ports/firestoreServiceRuntimePort';

const firestore = vi.hoisted(() => ({
  collection: vi.fn(() => ({})),
  getDocsFromServer: vi.fn(),
}));
vi.mock('firebase/firestore', async importOriginal => ({
  ...(await importOriginal<typeof import('firebase/firestore')>()),
  ...firestore,
}));

import {
  E2E_INVALID_CLINICAL_EPISODES_KEY,
  loadInvalidClinicalEpisodeIds,
} from '@/services/census/invalidClinicalEpisodeService';

const runtime = { ready: Promise.resolve(), getDb: () => ({}) } as FirestoreServiceRuntimePort;

describe('loadInvalidClinicalEpisodeIds', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    firestore.getDocsFromServer.mockResolvedValue({ docs: [{ id: '900200' }] });
  });
  afterEach(() => localStorage.clear());

  it('reads the server on a local run against Firebase, even though localhost looks like E2E', async () => {
    expect(window.location.hostname).toBe('localhost');

    expect([...(await loadInvalidClinicalEpisodeIds(runtime))]).toEqual(['900200']);
    expect(firestore.getDocsFromServer).toHaveBeenCalledOnce();
  });

  it('uses the marks an E2E run seeded, without a server', async () => {
    localStorage.setItem(E2E_INVALID_CLINICAL_EPISODES_KEY, JSON.stringify(['900300']));

    expect([...(await loadInvalidClinicalEpisodeIds(runtime))]).toEqual(['900300']);
    expect(firestore.getDocsFromServer).not.toHaveBeenCalled();
  });

  it('propagates a failed server read so the sync stops', async () => {
    firestore.getDocsFromServer.mockRejectedValue(new Error('unavailable'));

    await expect(loadInvalidClinicalEpisodeIds(runtime)).rejects.toThrow('unavailable');
  });
});
