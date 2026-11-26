// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { firestoreProviderConstructor } = vi.hoisted(() => ({
  firestoreProviderConstructor: vi.fn(),
}));

vi.mock('@/services/infrastructure/db/FirestoreProvider', () => ({
  FirestoreProvider: class MockFirestoreProvider {
    constructor(options: unknown) {
      firestoreProviderConstructor(options);
      return { kind: 'provider' };
    }
  },
}));

import { createFirestoreDatabaseProvider } from '@/services/storage/firestore/firestoreDatabaseProvider';

describe('createFirestoreDatabaseProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('wires FirestoreProvider to the injected runtime getter', () => {
    const customDb = { name: 'custom-provider-db' };
    createFirestoreDatabaseProvider({
      getDb: () => customDb as never,
      ready: Promise.resolve(),
    });

    expect(firestoreProviderConstructor).toHaveBeenCalledWith(
      expect.objectContaining({
        getFirestore: expect.any(Function),
      })
    );

    const options = firestoreProviderConstructor.mock.calls[0]?.[0] as {
      getFirestore: () => unknown;
    };
    expect(options.getFirestore()).toBe(customDb);
  });
});
