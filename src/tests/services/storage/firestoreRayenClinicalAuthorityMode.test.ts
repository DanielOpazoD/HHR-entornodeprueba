// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getDoc: vi.fn(),
  doc: vi.fn((_db: unknown, path: string) => ({ path })),
}));

vi.mock('firebase/firestore', () => ({
  doc: mocks.doc,
  getDoc: mocks.getDoc,
}));

import { isServerClinicalWriteFenceActive } from '@/services/storage/firestore/firestoreRayenClinicalAuthorityMode';
import type { FirestoreServiceRuntimePort } from '@/services/storage/firestore/ports/firestoreServiceRuntimePort';

const runtime = {
  getDb: () => ({}) as ReturnType<FirestoreServiceRuntimePort['getDb']>,
  ready: Promise.resolve(),
} satisfies FirestoreServiceRuntimePort;

const policySnapshot = (data: Record<string, unknown> | null) => ({
  exists: () => data !== null,
  data: () => data ?? {},
});

describe('firestoreRayenClinicalAuthorityMode', () => {
  beforeEach(() => {
    mocks.getDoc.mockReset();
    mocks.doc.mockClear();
  });

  it.each(['off', 'shadow', 'enforced'] as const)(
    'keeps the schema-v2 write fence active in %s mode',
    async clinicalBatchMode => {
      mocks.getDoc.mockResolvedValue(policySnapshot({ schemaVersion: 2, clinicalBatchMode }));

      await expect(isServerClinicalWriteFenceActive(runtime)).resolves.toBe(true);
      expect(mocks.doc).toHaveBeenCalledOnce();
      expect(mocks.getDoc).toHaveBeenCalledOnce();
    }
  );

  it('does not activate the write fence from an old or missing policy', async () => {
    for (const policy of [{ schemaVersion: 1, clinicalBatchMode: 'enforced' }, null]) {
      mocks.getDoc.mockResolvedValueOnce(policySnapshot(policy));
      await expect(isServerClinicalWriteFenceActive(runtime)).resolves.toBe(false);
    }
  });

  it('leaves the fence inactive when the policy cannot be read, so the rules decide', async () => {
    mocks.getDoc.mockRejectedValue(new Error('offline'));
    await expect(isServerClinicalWriteFenceActive(runtime)).resolves.toBe(false);
  });
});
