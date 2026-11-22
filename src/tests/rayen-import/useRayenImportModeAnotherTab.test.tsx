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

// The listener reports the policy missing, so the hook confirms it with a REST read only while
// this tab still owns the shared browser session; once B signs in in another tab, tab A stands down.
it('enables Rayen from the server read in its own session and stands down after B signs in elsewhere', async () => {
  const createFetch = () =>
    vi.fn(
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

  // Own active session: REST confirmation succeeds.
  listener.next = null;
  admitSyntheticSession('user:synthetic-reader-a', 'generation-a');
  const ownFetch = createFetch();
  vi.stubGlobal('fetch', ownFetch);
  const ownHook = renderHook(() => useRayenImportMode());
  try {
    await waitFor(() => expect(listener.next).not.toBeNull());
    await act(async () =>
      listener.next!({
        exists: () => false,
        data: () => undefined,
        metadata: { fromCache: false, hasPendingWrites: false },
      })
    );
    await waitFor(() => expect(ownHook.result.current.status).not.toBe('loading'));
    expect(ownFetch).toHaveBeenCalledTimes(1);
    expect(ownHook.result.current.status).toBe('ready');
    expect(ownHook.result.current.policy.revision).toBe(7);
  } finally {
    ownHook.unmount();
  }

  // After B replaced the browser owner in another tab: tab A never fetches or enables Rayen.
  listener.next = null;
  replaceStoredSessionOwner('user:synthetic-reader-b');
  const staleFetch = createFetch();
  vi.stubGlobal('fetch', staleFetch);
  const staleHook = renderHook(() => useRayenImportMode());
  try {
    await waitFor(() => expect(listener.next).not.toBeNull());
    await act(async () =>
      listener.next!({
        exists: () => false,
        data: () => undefined,
        metadata: { fromCache: false, hasPendingWrites: false },
      })
    );
    await waitFor(() => expect(staleHook.result.current.status).not.toBe('loading'));
    expect(staleFetch).not.toHaveBeenCalled();
    expect(staleHook.result.current.status).toBe('fallback');
  } finally {
    staleHook.unmount();
  }
});
