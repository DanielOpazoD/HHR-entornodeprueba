import { afterEach, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useRayenImportMode } from '@/features/rayen-import/hooks/useRayenImportMode';
import {
  admitSyntheticSession,
  clearSyntheticSession,
  replaceStoredSessionOwner,
} from '@/tests/utils/syntheticSession';

const listener = vi.hoisted(() => ({ next: null as null | ((snapshot: unknown) => void) }));
vi.mock('firebase/firestore', async original => ({
  ...(await original<typeof import('firebase/firestore')>()),
  doc: vi.fn(() => ({})),
  onSnapshot: vi.fn((_ref, _options, next) => {
    listener.next = next;
    return vi.fn();
  }),
}));
vi.mock('@/services/storage/firestore', () => ({ ensureFirestoreRuntimeReady: async () => {} }));
vi.mock('@/services/storage/firestore/firestoreServiceRuntime', () => ({
  defaultFirestoreServiceRuntime: {
    getDb: () => ({ app: { options: { projectId: 'demo-hhr' } } }),
  },
}));
vi.mock('@/services/auth/authRequestHeaders', () => ({
  resolveCurrentUserAuthHeaders: async () => ({ Authorization: 'Bearer synthetic-reader-a' }),
}));

afterEach(() => {
  clearSyntheticSession();
  vi.unstubAllGlobals();
});

// The listener reports the policy missing, so the hook confirms it with a REST read (W18-S2b review).
it.each(['in its own session', 'after B signed in in another tab'])(
  'a valid server answer enables Rayen: %s',
  async situation => {
    listener.next = null;
    admitSyntheticSession('user:synthetic-reader-a', 'generation-a');
    if (situation !== 'in its own session') replaceStoredSessionOwner('user:synthetic-reader-b');
    const fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            fields: {
              mode: { stringValue: 'preview' },
              revision: { integerValue: '7' },
              schemaVersion: { integerValue: '2' },
              clinicalBatchMode: { stringValue: 'enforced' },
              updatedByUid: { stringValue: 'synthetic-admin' },
              updatedAt: { timestampValue: '2026-11-07T03:40:42Z' },
            },
          }),
          { status: 200 }
        )
    );
    vi.stubGlobal('fetch', fetch);
    const { result, unmount } = renderHook(() => useRayenImportMode());
    try {
      await waitFor(() => expect(listener.next).not.toBeNull());
      await act(async () =>
        listener.next!({
          exists: () => false,
          data: () => undefined,
          metadata: { fromCache: false, hasPendingWrites: false },
        })
      );
      await waitFor(() => expect(result.current.status).not.toBe('loading'));
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(result.current.status).toBe('ready');
      expect(result.current.policy.revision).toBe(7);
    } finally {
      unmount();
    }
  }
);
