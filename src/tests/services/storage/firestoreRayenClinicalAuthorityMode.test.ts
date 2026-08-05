import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  configuredMode: 'client_only' as 'client_only' | 'shadow' | 'enforced',
  getDoc: vi.fn(),
  doc: vi.fn((_db: unknown, path: string) => ({ path })),
}));

vi.mock('firebase/firestore', () => ({
  doc: mocks.doc,
  getDoc: mocks.getDoc,
}));

vi.mock('@/services/storage/firestore/dailyRecordAuthorityMode', () => ({
  resolveDailyRecordAuthorityMode: () => mocks.configuredMode,
}));

import {
  isServerClinicalBatchEnforced,
  isServerClinicalWriteFenceActive,
  resolveEffectiveDailyRecordAuthorityMode,
} from '@/services/storage/firestore/firestoreRayenClinicalAuthorityMode';
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
    mocks.configuredMode = 'client_only';
    mocks.getDoc.mockReset();
    mocks.doc.mockClear();
  });

  it('uses the configured deployment mode only when no authoritative policy exists', async () => {
    mocks.configuredMode = 'enforced';
    mocks.getDoc.mockResolvedValue(policySnapshot(null));

    await expect(resolveEffectiveDailyRecordAuthorityMode(runtime)).resolves.toBe('enforced');
    expect(mocks.getDoc).toHaveBeenCalledOnce();
  });

  it('does not report server Rayen enforcement from the legacy deployment flag', async () => {
    mocks.configuredMode = 'enforced';
    mocks.getDoc.mockResolvedValue(policySnapshot({ schemaVersion: 2, clinicalBatchMode: 'off' }));

    await expect(isServerClinicalBatchEnforced(runtime)).resolves.toBe(false);
    expect(mocks.getDoc).toHaveBeenCalledOnce();
  });

  it.each(['off', 'shadow', 'enforced'] as const)(
    'keeps the schema-v2 write fence active in %s mode',
    async clinicalBatchMode => {
      mocks.getDoc.mockResolvedValue(policySnapshot({ schemaVersion: 2, clinicalBatchMode }));

      await expect(isServerClinicalWriteFenceActive(runtime)).resolves.toBe(true);
    }
  );

  it('does not activate the write fence before policy schema v2 exists', async () => {
    mocks.getDoc.mockResolvedValue(
      policySnapshot({ schemaVersion: 1, clinicalBatchMode: 'enforced' })
    );

    await expect(isServerClinicalWriteFenceActive(runtime)).resolves.toBe(false);
  });

  it('promotes a legacy client when the schema-v2 global policy is enforced', async () => {
    mocks.getDoc.mockResolvedValue(
      policySnapshot({ schemaVersion: 2, clinicalBatchMode: 'enforced' })
    );

    await expect(resolveEffectiveDailyRecordAuthorityMode(runtime)).resolves.toBe('enforced');
    expect(mocks.doc).toHaveBeenCalledOnce();
    expect(mocks.getDoc).toHaveBeenCalledOnce();
  });

  it.each(['off', 'shadow'] as const)(
    'does not let the schema-v2 global policy %s weaken enforced daily-record authority',
    async clinicalBatchMode => {
      mocks.configuredMode = 'enforced';
      mocks.getDoc.mockResolvedValue(policySnapshot({ schemaVersion: 2, clinicalBatchMode }));

      await expect(resolveEffectiveDailyRecordAuthorityMode(runtime)).resolves.toBe('enforced');
    }
  );

  it('promotes client-only daily-record authority while the global policy is shadow', async () => {
    mocks.getDoc.mockResolvedValue(
      policySnapshot({ schemaVersion: 2, clinicalBatchMode: 'shadow' })
    );

    await expect(resolveEffectiveDailyRecordAuthorityMode(runtime)).resolves.toBe('shadow');
  });

  it('does not promote from an old, off or missing policy', async () => {
    for (const policy of [
      { schemaVersion: 1, clinicalBatchMode: 'enforced' },
      { schemaVersion: 2, clinicalBatchMode: 'off' },
      null,
    ]) {
      mocks.getDoc.mockResolvedValueOnce(policySnapshot(policy));
      await expect(resolveEffectiveDailyRecordAuthorityMode(runtime)).resolves.toBe('client_only');
    }
  });

  it('preserves the configured mode when the policy cannot be read', async () => {
    mocks.configuredMode = 'shadow';
    mocks.getDoc.mockRejectedValue(new Error('offline'));

    await expect(resolveEffectiveDailyRecordAuthorityMode(runtime)).resolves.toBe('shadow');
  });
});
