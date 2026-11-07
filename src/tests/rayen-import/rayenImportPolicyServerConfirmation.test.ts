import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Timestamp } from 'firebase/firestore';

const firestore = vi.hoisted(() => ({
  listener: null as null | ((snapshot: unknown) => void),
  readFromServer: vi.fn(),
}));

vi.mock('firebase/firestore', async importOriginal => ({
  ...(await importOriginal<typeof import('firebase/firestore')>()),
  doc: vi.fn(() => ({ path: 'hospitals/hanga_roa/settings/rayenImportPolicy' })),
  onSnapshot: vi.fn((_ref, _options, next: (snapshot: unknown) => void) => {
    firestore.listener = next;
    return vi.fn();
  }),
}));
vi.mock('@/features/rayen-import/settings/policyServerRead', () => ({
  default: firestore.readFromServer,
}));
vi.mock('@/services/storage/firestore', () => ({
  ensureFirestoreRuntimeReady: vi.fn(async () => undefined),
}));

import {
  subscribeToRayenImportPolicy,
  type RayenImportPolicySnapshot,
} from '@/features/rayen-import/settings/rayenImportPolicyService';

const POLICY = {
  mode: 'preview',
  clinicalBatchMode: 'enforced',
  revision: 7,
  schemaVersion: 2,
  updatedAt: Timestamp.fromMillis(Date.parse('2026-11-07T03:40:42.000Z')),
  updatedByUid: 'synthetic-admin',
};
const docSnapshot = (data: Record<string, unknown> | null, fromCache = false) => ({
  exists: () => data !== null,
  data: () => data ?? undefined,
  metadata: { fromCache, hasPendingWrites: false },
});
const runtime = { getDb: () => ({}) } as never;

const subscribe = async () => {
  const snapshots: RayenImportPolicySnapshot[] = [];
  const errors: unknown[] = [];
  subscribeToRayenImportPolicy(
    { onSnapshot: snapshot => snapshots.push(snapshot), onError: error => errors.push(error) },
    runtime
  );
  await vi.waitFor(() => expect(firestore.listener).not.toBeNull());
  return { snapshots, errors };
};

describe('Eloísa sync policy: a missing document is confirmed with the server', () => {
  beforeEach(() => {
    firestore.listener = null;
    firestore.readFromServer.mockReset();
  });

  it('uses the server policy when the local copy wrongly says it does not exist', async () => {
    firestore.readFromServer.mockResolvedValue(POLICY);
    const { snapshots } = await subscribe();

    firestore.listener!(docSnapshot(null));

    await vi.waitFor(() => expect(snapshots).toHaveLength(1));
    expect(snapshots[0]).toMatchObject({
      exists: true,
      fromCache: false,
      policy: expect.objectContaining({ mode: 'preview', revision: 7 }),
    });
  });

  it('reports the policy missing only when the server confirms it', async () => {
    firestore.readFromServer.mockResolvedValue(null);
    const { snapshots } = await subscribe();

    firestore.listener!(docSnapshot(null));

    await vi.waitFor(() => expect(snapshots).toHaveLength(1));
    expect(snapshots[0]).toMatchObject({ exists: false, fromCache: false, policy: null });
  });

  it('treats a failed confirmation as a failed read, never as «not configured»', async () => {
    const failure = Object.assign(new Error('offline'), { code: 'unavailable' });
    firestore.readFromServer.mockRejectedValue(failure);
    const { snapshots, errors } = await subscribe();

    firestore.listener!(docSnapshot(null));

    await vi.waitFor(() => expect(errors).toEqual([failure]));
    expect(snapshots).toEqual([]);
  });

  it('lets a newer listener answer win over a late confirmation', async () => {
    let answer: (value: unknown) => void = () => undefined;
    firestore.readFromServer.mockReturnValue(new Promise(resolve => (answer = resolve)));
    const { snapshots } = await subscribe();

    firestore.listener!(docSnapshot(null));
    firestore.listener!(docSnapshot(POLICY));
    answer(null);
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(snapshots).toEqual([expect.objectContaining({ exists: true })]);
  });

  it('passes a cached answer through unchanged, without asking the server', async () => {
    const { snapshots } = await subscribe();

    firestore.listener!(docSnapshot(null, true));

    expect(firestore.readFromServer).not.toHaveBeenCalled();
    expect(snapshots).toEqual([expect.objectContaining({ exists: false, fromCache: true })]);
  });
});
