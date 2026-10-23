import { createRequire } from 'node:module';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { accountFixture } from './nursingAccounts.test-support';

const require = createRequire(import.meta.url);
const { rateLimit } = require('../../../functions/lib/accounts/accountTransport.js');
const { digest, INDEX } = require('../../../functions/lib/accounts/accountPolicy.js');
const timestamp = Date.parse('2026-10-21T23:00:00Z');
const windowEnd = timestamp + 5 * 60000;
const pathFor = (key: string) => `hhr_account_rate_limits/${digest(key)}`;
const context = { rawRequest: { ip: '127.0.0.20' } };
const accountKey = 'synthetic-account-digest';
const ipPath = pathFor(`ip:${context.rawRequest.ip}`);
const accountPath = pathFor(`account:${accountKey}`);

const setup = () => {
  vi.spyOn(Date, 'now').mockReturnValue(timestamp);
  const fixture = accountFixture();
  const batchReads: string[][] = [];
  const firestore = {
    ...fixture.firestore,
    runTransaction: vi.fn(
      <T>(callback: Parameters<typeof fixture.firestore.runTransaction<T>>[0]) =>
        fixture.firestore.runTransaction(tx =>
          callback({
            ...tx,
            getAll: async (...refs) => {
              batchReads.push(refs.map(ref => ref.path));
              return tx.getAll(...refs);
            },
          })
        )
    ),
  };
  return { ...fixture, firestore, batchReads };
};

afterEach(() => vi.restoreAllMocks());

describe('atomic account and IP rate limits', () => {
  it('consumes the same hashed counters with one transaction and one batched read', async () => {
    const f = setup();
    await expect(rateLimit(f.firestore, context, accountKey)).resolves.toBeUndefined();
    expect(f.firestore.runTransaction).toHaveBeenCalledTimes(1);
    expect(f.batchReads).toEqual([[ipPath, accountPath]]);
    expect(f.documents.get(ipPath)).toEqual({ count: 1, until: windowEnd });
    expect(f.documents.get(accountPath)).toEqual({ count: 1, until: windowEnd });
  });

  it('batches an optional lookup and exposes it only after the transaction commits', async () => {
    const f = setup();
    const lookupRef = f.firestore.collection(INDEX).doc('synthetic-index');
    f.documents.set(lookupRef.path, { uid: 'synthetic-account' });
    let commit: () => void = () => undefined;
    const pendingCommit = new Promise<void>(resolve => {
      commit = resolve;
    });
    let readCompleted: () => void = () => undefined;
    const lookupRead = new Promise<void>(resolve => {
      readCompleted = resolve;
    });
    const firestore = {
      ...f.firestore,
      runTransaction: async (callback: Parameters<typeof f.firestore.runTransaction>[0]) => {
        const result = await f.firestore.runTransaction(callback);
        readCompleted();
        await pendingCommit;
        return result;
      },
    };
    let returned = false;
    const result = rateLimit(firestore, context, accountKey, lookupRef).then(
      (snapshot: Awaited<ReturnType<typeof lookupRef.get>> | undefined) => {
        returned = true;
        return snapshot;
      }
    );
    await lookupRead;
    expect(returned).toBe(false);
    commit();
    expect((await result)?.data()).toEqual({ uid: 'synthetic-account' });
    expect(f.batchReads).toEqual([[ipPath, accountPath, lookupRef.path]]);
    expect(f.documents.get(ipPath)).toEqual({ count: 1, until: windowEnd });
    expect(f.documents.get(accountPath)).toEqual({ count: 1, until: windowEnd });
  });

  it('returns the lookup snapshot from the committed retry rather than an abandoned attempt', async () => {
    const f = setup();
    const lookupRef = f.firestore.collection(INDEX).doc('synthetic-index');
    const batchReads: string[][] = [];
    const firestore = {
      ...f.firestore,
      runTransaction: async (callback: Parameters<typeof f.firestore.runTransaction>[0]) => {
        const attempt = (uid: string) =>
          callback({
            get: async () => {
              throw new Error('the lookup must use the existing batched read');
            },
            getAll: async (...refs) => {
              batchReads.push(refs.map(ref => ref.path));
              return refs.map(ref => ({
                id: ref.path.split('/').at(-1),
                exists: ref.path === lookupRef.path,
                data: () => (ref.path === lookupRef.path ? { uid } : undefined),
              }));
            },
            create: vi.fn(),
            set: vi.fn(),
            update: vi.fn(),
          });
        await attempt('abandoned-account');
        return attempt('committed-account');
      },
    };
    const result = await rateLimit(firestore, context, accountKey, lookupRef);
    expect(result?.data()).toEqual({ uid: 'committed-account' });
    expect(batchReads).toEqual([
      [ipPath, accountPath, lookupRef.path],
      [ipPath, accountPath, lookupRef.path],
    ]);
  });

  it('never exposes a lookup or consumes counters if the read or commit fails', async () => {
    const f = setup();
    const lookupRef = f.firestore.collection(INDEX).doc('synthetic-index');
    f.documents.set(lookupRef.path, { uid: 'must-not-be-returned' });
    for (const failure of ['read', 'commit']) {
      const writes = vi.fn();
      const error = new Error(`${failure} unavailable`);
      const firestore = {
        ...f.firestore,
        runTransaction: async (callback: Parameters<typeof f.firestore.runTransaction>[0]) => {
          await callback({
            get: ref => f.firestore.doc(ref.path).get(),
            getAll: async (...refs) => {
              if (failure === 'read') throw error;
              return Promise.all(refs.map(ref => f.firestore.doc(ref.path).get()));
            },
            create: writes,
            update: writes,
            set: writes,
          });
          throw error;
        },
      };
      await expect(rateLimit(firestore, context, accountKey, lookupRef)).rejects.toBe(error);
      expect(f.documents.has(ipPath)).toBe(false);
      expect(f.documents.has(accountPath)).toBe(false);
      if (failure === 'read') expect(writes).not.toHaveBeenCalled();
    }
  });

  it('keeps the IP consumption when the account limit rejects the attempt', async () => {
    const f = setup();
    f.documents.set(ipPath, { count: 5, until: windowEnd });
    f.documents.set(accountPath, { count: 10, until: windowEnd });
    await expect(rateLimit(f.firestore, context, accountKey)).rejects.toMatchObject({
      code: 'resource-exhausted',
      message: 'Espera unos minutos antes de volver a intentar.',
    });
    expect(f.documents.get(ipPath)).toEqual({ count: 6, until: windowEnd });
    expect(f.documents.get(accountPath)).toEqual({ count: 10, until: windowEnd });
    expect(f.firestore.runTransaction).toHaveBeenCalledTimes(1);
  });

  it('does not consume the account counter when the IP limit rejects the attempt', async () => {
    const f = setup();
    f.documents.set(ipPath, { count: 100, until: windowEnd });
    f.documents.set(accountPath, { count: 4, until: windowEnd });
    await expect(rateLimit(f.firestore, context, accountKey)).rejects.toMatchObject({
      code: 'resource-exhausted',
    });
    expect(f.documents.get(ipPath)).toEqual({ count: 100, until: windowEnd });
    expect(f.documents.get(accountPath)).toEqual({ count: 4, until: windowEnd });
  });

  it.each(['ip', 'account', 'both'])(
    'resets only the expired %s window, including the exact expiration instant',
    async expired => {
      const f = setup();
      const ipExpired = expired === 'ip' || expired === 'both';
      const accountExpired = expired === 'account' || expired === 'both';
      f.documents.set(ipPath, {
        count: ipExpired ? 100 : 5,
        until: ipExpired ? timestamp : windowEnd + 10,
      });
      f.documents.set(accountPath, {
        count: accountExpired ? 10 : 5,
        until: accountExpired ? timestamp : windowEnd + 20,
      });
      await rateLimit(f.firestore, context, accountKey);
      expect(f.documents.get(ipPath)).toEqual({
        count: ipExpired ? 1 : 6,
        until: ipExpired ? windowEnd : windowEnd + 10,
      });
      expect(f.documents.get(accountPath)).toEqual({
        count: accountExpired ? 1 : 6,
        until: accountExpired ? windowEnd : windowEnd + 20,
      });
    }
  );

  it('admits exactly ten concurrent attempts for one account while charging every allowed IP attempt', async () => {
    const f = setup();
    const results = await Promise.allSettled(
      Array.from({ length: 15 }, () => rateLimit(f.firestore, context, accountKey))
    );
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(10);
    expect(results.filter(result => result.status === 'rejected')).toHaveLength(5);
    expect(f.documents.get(ipPath)).toEqual({ count: 15, until: windowEnd });
    expect(f.documents.get(accountPath)).toEqual({ count: 10, until: windowEnd });
  });

  it('admits exactly one hundred concurrent IP attempts across different accounts', async () => {
    const f = setup();
    const results = await Promise.allSettled(
      Array.from({ length: 105 }, (_, index) =>
        rateLimit(f.firestore, context, `synthetic-${index}`)
      )
    );
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(100);
    expect(results.filter(result => result.status === 'rejected')).toHaveLength(5);
    expect(f.documents.get(ipPath)).toEqual({ count: 100, until: windowEnd });
    const accountCounters = [...f.documents.entries()].filter(([path]) => path !== ipPath);
    expect(accountCounters).toHaveLength(100);
    expect(accountCounters.every(([, data]) => data.count === 1)).toBe(true);
  });

  it.each([
    {
      rawRequest: { ip: '127.0.0.21', headers: { 'x-forwarded-for': 'untrusted' } },
      expectedIp: '127.0.0.21',
    },
    { rawRequest: { socket: { remoteAddress: '127.0.0.22' } }, expectedIp: '127.0.0.22' },
    { rawRequest: {}, expectedIp: 'unknown' },
  ])(
    'uses the normalized platform IP or existing fallback ($expectedIp)',
    async ({ rawRequest, expectedIp }) => {
      const f = setup();
      await rateLimit(f.firestore, { rawRequest }, accountKey);
      expect(f.documents.get(pathFor(`ip:${expectedIp}`))).toEqual({ count: 1, until: windowEnd });
      expect(f.documents.has(pathFor('ip:untrusted'))).toBe(false);
    }
  );
});
