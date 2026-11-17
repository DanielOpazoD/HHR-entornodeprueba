// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { createRepositoryFirestoreRuntime } from '@/services/repositories/repositoryFirestoreRuntime';
import { createFirestoreServiceRuntime } from '@/services/storage/firestore/firestoreServiceRuntime';
import type { FirestoreRuntime } from '@/services/firebase-runtime/firestoreRuntime';

describe('firestore runtime adapters', () => {
  it('creates a storage/firestore service runtime from an injected firestore runtime', async () => {
    const db = { runtime: 'db' };
    const runtime: FirestoreRuntime = {
      db: db as never,
      ready: Promise.resolve(),
    };

    const serviceRuntime = createFirestoreServiceRuntime(runtime);

    await expect(serviceRuntime.ready).resolves.toBeUndefined();
    expect(serviceRuntime.getDb()).toBe(db);
  });

  it('creates a repository firestore runtime from an injected firestore runtime', () => {
    const db = { runtime: 'repository-db' };

    const repositoryRuntime = createRepositoryFirestoreRuntime({
      db: db as never,
    });

    expect(repositoryRuntime.getDb()).toBe(db);
  });
});
