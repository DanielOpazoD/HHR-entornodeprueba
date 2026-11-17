// @vitest-environment node
import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { getLocalPersistenceRuntimeSnapshot } from '@/services/storage/indexeddb/indexedDbCore';

describe('localPersistenceRuntimeSnapshot contract', () => {
  it('exposes the snapshot through the canonical storage/core entrypoint', () => {
    const snapshot = getLocalPersistenceRuntimeSnapshot();

    expect(snapshot).toEqual(
      expect.objectContaining({
        indexedDbAvailable: expect.any(Boolean),
        fallbackMode: expect.any(Boolean),
        stickyFallbackMode: expect.any(Boolean),
      })
    );
    expect(['ok', 'recoverable', 'blocked']).toContain(snapshot.runtimeState);
  });
});
