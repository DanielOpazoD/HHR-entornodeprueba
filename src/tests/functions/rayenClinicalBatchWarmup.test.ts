// @vitest-environment node
import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';
import {
  createRayenClinicalEnrichmentFunctions,
  makeContext,
  makePayload,
} from './rayenClinicalEnrichmentFunctions.test-support';

const require = createRequire(import.meta.url);
const { createAuthHelpers } = require('../../../functions/lib/auth/authHelpersFactory.js');
const { isClinicalBatchWarmup } = require('../../../functions/lib/rayenClinicalBatchWarmup.js');

/**
 * One database for the role lookup and the callable, as in `functions/index.js`. It answers only
 * document reads and records every path read; any other access (a write, a transaction, a query)
 * is recorded as such and fails.
 */
const createRecordingFirestore = (roles: Record<string, string>) => {
  const reads: string[] = [];
  const otherAccess: string[] = [];
  const documentAt = (path: string) => ({
    get: async () => {
      reads.push(path);
      if (path === 'config/roles') return { exists: true, data: () => roles };
      return { exists: false, data: () => undefined };
    },
    set: async () => otherAccess.push(`set ${path}`),
    update: async () => otherAccess.push(`update ${path}`),
    create: async () => otherAccess.push(`create ${path}`),
    delete: async () => otherAccess.push(`delete ${path}`),
    collection: (name: string) => collectionAt(`${path}/${name}`),
  });
  const collectionAt = (path: string) => ({
    doc: (id: string) => documentAt(`${path}/${id}`),
    add: async () => otherAccess.push(`add ${path}`),
    get: async () => otherAccess.push(`query ${path}`),
    where: () => otherAccess.push(`query ${path}`),
  });
  const firestore = {
    collection: (name: string) => collectionAt(name),
    doc: (path: string) => documentAt(path),
    runTransaction: async () => {
      otherAccess.push('transaction');
      throw new Error('The recording database runs no transactions.');
    },
    batch: () => otherAccess.push('batch'),
  };
  return { firestore, reads, otherAccess };
};

const createApi = (roles: Record<string, string>) => {
  const database = createRecordingFirestore(roles);
  const { resolveRoleForEmail } = createAuthHelpers({ auth: {}, firestore: database.firestore });
  const api = createRayenClinicalEnrichmentFunctions({
    firestore: database.firestore,
    Timestamp: { now: vi.fn() },
    FieldValue: {},
    resolveRoleForEmail,
  });
  return { ...database, api };
};

const googleContext = () => ({
  auth: {
    uid: 'synthetic-nurse-1',
    token: { email: 'nurse@example.com', firebase: { sign_in_provider: 'google.com' } },
  },
});

describe('clinical batch warm-up on the server', () => {
  it('answers a signed-in writer after reading only access and role documents', async () => {
    const { api, reads, otherAccess } = createApi({ 'nurse@example.com': 'nurse_hospital' });

    await expect(
      api.applyRayenClinicalEnrichmentBatch.run({ warmup: true }, googleContext())
    ).resolves.toEqual({ warmed: true });

    // The role lookup is the connection-opening RPC: no daily record, history, clinicalDerived,
    // policy or telemetry document is touched, and nothing is written.
    expect(reads).toEqual([
      'hhr_account_access/synthetic-nurse-1',
      'config/individualAccounts',
      'config/roles',
    ]);
    expect(otherAccess).toEqual([]);
  });

  it('refuses an unauthenticated caller before reading anything', async () => {
    const { api, reads, otherAccess } = createApi({ 'nurse@example.com': 'nurse_hospital' });

    await expect(
      api.applyRayenClinicalEnrichmentBatch.run({ warmup: true }, {})
    ).rejects.toMatchObject({ code: 'unauthenticated' });
    expect(reads).toEqual([]);
    expect(otherAccess).toEqual([]);
  });

  it('refuses a role that cannot save, without telemetry or other writes', async () => {
    const { api, reads, otherAccess } = createApi({ 'nurse@example.com': 'viewer' });

    await expect(
      api.applyRayenClinicalEnrichmentBatch.run({ warmup: true }, googleContext())
    ).rejects.toMatchObject({ code: 'permission-denied' });
    expect(reads).toEqual([
      'hhr_account_access/synthetic-nurse-1',
      'config/individualAccounts',
      'config/roles',
    ]);
    expect(otherAccess).toEqual([]);
  });

  it('never mistakes a save payload for a warm-up', async () => {
    expect(isClinicalBatchWarmup({ warmup: true })).toBe(true);
    for (const data of [
      { ...makePayload(), warmup: true },
      { warmup: 'true' },
      { warmup: true, date: '2026-07-28' },
      [true],
      null,
      undefined,
      {},
    ]) {
      expect(isClinicalBatchWarmup(data)).toBe(false);
    }

    // A save that also carries `warmup` still goes through the save path, which opens its
    // transaction (refused here by the recording database) instead of answering `warmed`.
    const { api, otherAccess } = createApi({ 'nurse@example.com': 'nurse_hospital' });
    await expect(
      api.applyRayenClinicalEnrichmentBatch.run({ ...makePayload(), warmup: true }, makeContext())
    ).rejects.toMatchObject({ code: 'internal' });
    expect(otherAccess).toContain('transaction');
  });
});
