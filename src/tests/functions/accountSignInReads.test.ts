import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';
import { accountFixture } from './nursingAccounts.test-support';

const require = createRequire(import.meta.url);
const {
  createAccountCredentials,
} = require('../../../functions/lib/accounts/accountCredentials.js');
const {
  beginInitialPassword,
} = require('../../../functions/lib/accounts/accountInitialPassword.js');
const {
  ACCESS,
  INDEX,
  INVITES,
  digest,
  normalizeRut,
} = require('../../../functions/lib/accounts/accountPolicy.js');
const rut = '111111111';
const uid = 'synthetic-login-account';
const email = `${uid}@accounts.hhr.invalid`;
const input = { rut, password: 'Synthetic1', apiKey: 'synthetic-key' };

const setup = () => {
  const f = accountFixture();
  const indexPath = `${INDEX}/${digest(normalizeRut(rut))}`;
  const accessPath = `${ACCESS}/${uid}`;
  f.documents.set(indexPath, { uid });
  f.documents.set(accessPath, { status: 'active', version: 1, role: 'nurse_hospital' });
  const events: string[] = [];
  const batchReads: string[][] = [];
  const firestore = {
    ...f.firestore,
    collection: (name: string) => {
      const collection = f.firestore.collection(name);
      return {
        ...collection,
        doc: (id?: string) => {
          const ref = collection.doc(id);
          return {
            ...ref,
            get: async () => {
              events.push(`read:${ref.path}`);
              return ref.get();
            },
          };
        },
      };
    },
    runTransaction: <T>(callback: Parameters<typeof f.firestore.runTransaction<T>>[0]) =>
      f.firestore.runTransaction(tx =>
        callback({
          ...tx,
          getAll: async (...refs) => {
            batchReads.push(refs.map(ref => ref.path));
            return tx.getAll(...refs);
          },
        })
      ),
  };
  const passwordVerifier = vi.fn(async () => {
    events.push('provider');
    return uid;
  });
  const credentials = createAccountCredentials({ ...f, firestore, passwordVerifier });
  return {
    ...f,
    firestore,
    credentials,
    passwordVerifier,
    events,
    batchReads,
    indexPath,
    accessPath,
  };
};

describe('RUT sign-in reads without permission caching', () => {
  it('uses one grouped counter/index read and only checks access after password verification', async () => {
    const f = setup();
    await expect(f.credentials.signInWithRut(input, f.context)).resolves.toEqual({
      credentialEmail: email,
    });
    expect(f.batchReads).toEqual([
      [
        `hhr_account_rate_limits/${digest(`ip:${f.context.rawRequest.ip}`)}`,
        `hhr_account_rate_limits/${digest(`account:${digest(normalizeRut(rut))}`)}`,
        f.indexPath,
      ],
    ]);
    expect(f.events).toEqual(['provider', `read:${f.accessPath}`]);
    expect(f.passwordVerifier).toHaveBeenCalledWith({
      auth: f.auth,
      email,
      password: input.password,
      apiKey: input.apiKey,
    });
    expect(f.auth.setCustomUserClaims).not.toHaveBeenCalled();
    expect(f.auth.updateUser).not.toHaveBeenCalled();
  });

  it.each([
    { status: 'suspended' },
    { status: 'retired' },
    { credentialOperation: 'reset-in-flight' },
  ])('rejects access changed during password verification: %j', async changed => {
    const f = setup();
    f.passwordVerifier.mockImplementationOnce(async () => {
      f.documents.set(f.accessPath, { ...f.documents.get(f.accessPath), ...changed });
      return uid;
    });
    await expect(f.credentials.signInWithRut(input, f.context)).rejects.toMatchObject({
      code: 'permission-denied',
    });
    expect(f.auth.setCustomUserClaims).not.toHaveBeenCalled();
  });

  it('rechecks access on the next login instead of reusing the previous active result', async () => {
    const f = setup();
    await f.credentials.signInWithRut(input, f.context);
    f.documents.set(f.accessPath, { status: 'suspended', version: 2 });
    await expect(f.credentials.signInWithRut(input, f.context)).rejects.toMatchObject({
      code: 'permission-denied',
    });
    expect(f.events).toEqual([
      'provider',
      `read:${f.accessPath}`,
      'provider',
      `read:${f.accessPath}`,
    ]);
  });

  it('still verifies unknown accounts through the provider and never returns their credential email', async () => {
    const f = setup();
    f.documents.delete(f.indexPath);
    await expect(f.credentials.signInWithRut(input, f.context)).rejects.toMatchObject({
      code: 'permission-denied',
    });
    expect(f.passwordVerifier).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'unknown-account@accounts.hhr.invalid' })
    );
    expect(f.events).toEqual(['provider']);
  });

  it('issues setup only for the exact initial numeric credential, without an Auth session', async () => {
    const f = setup();
    f.documents.set(f.accessPath, { status: 'pending', version: 1, initialPasswordEnabled: true });
    await expect(
      f.credentials.signInWithRut({ ...input, password: '12345678' }, f.context)
    ).rejects.toMatchObject({ code: 'permission-denied' });
    expect([...f.documents.keys()].filter(path => path.startsWith(`${INVITES}/`))).toEqual([]);
    await expect(
      f.credentials.signInWithRut({ ...input, password: '11111111' }, f.context)
    ).resolves.toEqual({ requiresSetup: true, activationToken: expect.any(String) });
    expect(f.passwordVerifier).not.toHaveBeenCalled();
    expect(f.auth.updateUser).not.toHaveBeenCalled();
    expect(f.documents.get(f.accessPath)?.status).toBe('pending');
  });

  it.each([
    { status: 'suspended' },
    { initialPasswordEnabled: false },
    { version: 2 },
    { credentialOperation: 'new-reset' },
  ])('revalidates setup after a concurrent account change: %j', async changed => {
    const f = setup();
    f.documents.set(f.accessPath, { status: 'pending', version: 1, initialPasswordEnabled: true });
    const firestore = {
      ...f.firestore,
      runTransaction: <T>(callback: Parameters<typeof f.firestore.runTransaction<T>>[0]) => {
        f.documents.set(f.accessPath, { ...f.documents.get(f.accessPath), ...changed });
        return f.firestore.runTransaction(callback);
      },
    };
    await expect(
      beginInitialPassword({
        firestore,
        uid,
        rut: normalizeRut(rut),
        password: '11111111',
        now: f.now,
      })
    ).rejects.toMatchObject({ code: 'permission-denied' });
    expect([...f.documents.keys()].filter(path => path.startsWith(`${INVITES}/`))).toEqual([]);
  });
});
