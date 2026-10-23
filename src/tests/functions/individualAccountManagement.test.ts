import { createRequire } from 'node:module';
import { describe, it, expect } from 'vitest';
import { accountFixture } from './nursingAccounts.test-support';
const require = createRequire(import.meta.url);
const {
  createAccountAdministration,
} = require('../../../functions/lib/accounts/accountAdministration.js');
const {
  createAccountCredentials,
} = require('../../../functions/lib/accounts/accountCredentials.js');
const { hasCurrentAccountSession } = require('../../../functions/lib/accounts/accountPolicy.js');
const setup = async (role = 'nurse_hospital') => {
  const f = accountFixture();
  const admin = createAccountAdministration(f);
  const credentials = createAccountCredentials(f);
  const { uid } = await admin.createAccount(
    { name: 'Persona Sintética', role, rut: '111111111', identityVerified: true },
    f.context
  );
  const initial = await credentials.signInWithRut(
    { rut: '111111111', password: '11111111' },
    f.context
  );
  await credentials.activateAccount(
    {
      rut: '111111111',
      activationToken: initial.activationToken,
      password: 'Synthetic123',
      recoveryEmail: 'test@example.invalid',
    },
    f.context
  );
  const ref = `hhr_account_access/${uid}`;
  const session = {
    auth: {
      uid,
      token: {
        hhrAccountVersion: f.documents.get(ref)?.version,
        auth_time: f.now() / 1000,
        firebase: { sign_in_provider: 'password' },
      },
    },
  };
  const manage = (action: string, extra = {}) =>
    admin.manageAccount({ uid, action, ...extra }, f.context);
  return { ...f, uid, ref, admin, credentials, session, manage };
};
describe('plain-language individual account management', () => {
  it.each(['admin', 'doctor_urgency', 'doctor_specialist', 'viewer'])(
    'preserves the assigned %s role on activation',
    async role => {
      const f = await setup(role);
      expect(f.documents.get(f.ref)?.role).toBe(role);
      expect(f.users.get(f.uid)?.customClaims).toMatchObject({ role });
    }
  );
  it('reset invalidates sessions, passwords and invites and requires initial setup again', async () => {
    const f = await setup();
    const beforePrivate = structuredClone(f.documents.get(`hhr_account_private/${f.uid}`));
    await f.manage('reset');
    expect(hasCurrentAccountSession(f.documents.get(f.ref), f.session, f.now())).toBe(false);
    await expect(
      f.credentials.signInWithRut({ rut: '111111111', password: 'Synthetic123' }, f.context)
    ).rejects.toThrow();
    const setupToken = await f.credentials.signInWithRut(
      { rut: '111111111', password: '11111111' },
      f.context
    );
    expect(setupToken.requiresSetup).toBe(true);
    expect(f.documents.get(f.ref)?.status).toBe('pending');
    expect(f.documents.get(`hhr_account_private/${f.uid}`)).toEqual(beforePrivate);
    expect(f.users.get(f.uid)?.disabled).toBe(true);
  });
  it('disables and re-enables without changing the personal password or allowing stale sessions', async () => {
    const f = await setup();
    await f.manage('suspend');
    await expect(
      f.credentials.signInWithRut({ rut: '111111111', password: 'Synthetic123' }, f.context)
    ).rejects.toThrow();
    await f.manage('enable');
    expect(f.users.get(f.uid)?.password).toBe('Synthetic123');
    await expect(
      f.credentials.signInWithRut({ rut: '111111111', password: 'Synthetic123' }, f.context)
    ).resolves.toHaveProperty('credentialEmail');
    expect(hasCurrentAccountSession(f.documents.get(f.ref), f.session, f.now())).toBe(false);
  });
  it('updates name/role in access and Auth while retaining RUT, recovery email and credentials', async () => {
    const f = await setup();
    const privateData = structuredClone(f.documents.get(`hhr_account_private/${f.uid}`));
    await f.manage('update', { name: 'Nombre Corregido', role: 'viewer' });
    expect(f.documents.get(f.ref)).toMatchObject({ name: 'Nombre Corregido', role: 'viewer' });
    expect(f.users.get(f.uid)).toMatchObject({
      displayName: 'Nombre Corregido',
      password: 'Synthetic123',
      customClaims: { role: 'viewer' },
    });
    expect(f.documents.get(`hhr_account_private/${f.uid}`)).toEqual(privateData);
    expect(hasCurrentAccountSession(f.documents.get(f.ref), f.session, f.now())).toBe(false);
    const audit = [...f.documents.values()].find(d => d.action === 'update');
    expect(audit).toMatchObject({
      previousName: 'Persona Sintética',
      previousRole: 'nurse_hospital',
      role: 'viewer',
    });
  });
  it('deletes only the Auth user; keeps the identity tombstone, audit and all historical data', async () => {
    const f = await setup();
    const clinical = { authorUid: f.uid, cudyr: { score: 9 }, note: 'Synthetic historical note' };
    f.documents.set('clinical/synthetic', structuredClone(clinical));
    await f.manage('delete');
    expect(f.auth.deleteUser).toHaveBeenCalledWith(f.uid);
    expect(f.users.has(f.uid)).toBe(false);
    expect(f.documents.get(f.ref)).toMatchObject({
      status: 'retired',
      name: 'Persona Sintética',
      credentialOperation: null,
    });
    expect(f.documents.get('clinical/synthetic')).toEqual(clinical);
    for (const action of ['enable', 'reset', 'suspend', 'update', 'invite'])
      await expect(f.manage(action, { name: 'Nombre Nuevo', role: 'admin' })).rejects.toThrow();
  });
  it('admin-only email listing and mutations reject stale or non-admin sessions', async () => {
    const f = await setup();
    expect((await f.admin.listAccounts({}, f.context)).accounts[0].recoveryEmail).toBe(
      'test@example.invalid'
    );
    await expect(f.admin.listAccounts({}, f.session)).rejects.toThrow();
    for (const action of ['reset', 'update', 'enable', 'delete'])
      await expect(f.admin.manageAccount({ uid: f.uid, action }, f.session)).rejects.toThrow();
    const stale = {
      ...f.context,
      auth: {
        ...f.context.auth,
        token: { ...f.context.auth.token, auth_time: f.now() / 1000 - 901 },
      },
    };
    await expect(f.admin.manageAccount({ uid: f.uid, action: 'reset' }, stale)).rejects.toThrow();
  });
  it('rejects invented roles and protected Google UIDs without touching Auth', async () => {
    const f = await setup();
    const before = f.auth.updateUser.mock.calls.length;
    await expect(f.manage('update', { name: 'Valid Name', role: 'owner' })).rejects.toThrow();
    await expect(
      f.admin.manageAccount({ uid: 'google-admin', action: 'delete' }, f.context)
    ).rejects.toThrow();
    expect(f.auth.updateUser).toHaveBeenCalledTimes(before);
  });
  it('a suspension during reset wins over late provider completion', async () => {
    const f = await setup();
    const update = f.auth.updateUser.getMockImplementation()!;
    f.auth.updateUser.mockImplementationOnce(async (uid, data) => {
      await f.manage('suspend');
      return update(uid, data);
    });
    await expect(f.manage('reset')).rejects.toThrow();
    expect(f.documents.get(f.ref)).toMatchObject({
      status: 'suspended',
      initialPasswordEnabled: false,
      credentialOperation: null,
    });
    expect(f.users.get(f.uid)?.disabled).toBe(true);
  });
  it('re-enables an established legacy password without guessing incomplete configurations', async () => {
    const f = await setup();
    await f.manage('suspend');
    const account = { ...f.documents.get(f.ref) };
    delete account.suspendedFrom;
    f.documents.set(f.ref, account);
    expect((await f.admin.listAccounts({}, f.context)).accounts[0].canEnable).toBe(true);
    await f.manage('enable');
    expect(f.users.get(f.uid)?.password).toBe('Synthetic123');
    expect(f.users.get(f.uid)?.disabled).toBe(false);
    await f.manage('suspend');
    const pendingLegacy: Record<string, unknown> = { ...f.documents.get(f.ref), version: 999 };
    delete pendingLegacy.suspendedFrom;
    f.documents.set(f.ref, pendingLegacy);
    await expect(f.manage('enable')).rejects.toThrow();
  });
  it('can complete real Auth deletion of an account retired by the old API', async () => {
    const f = await setup();
    await f.manage('retire');
    expect(f.users.has(f.uid)).toBe(true);
    expect((await f.admin.listAccounts({}, f.context)).accounts[0].deletedAt).toBeNull();
    await f.manage('delete');
    expect(f.users.has(f.uid)).toBe(false);
    expect(f.documents.get(f.ref)?.deletedAt).toBe(f.now());
  });
  it('uncertain Auth deletion fails closed and can be completed after the worker lifetime', async () => {
    const f = await setup();
    f.auth.deleteUser.mockRejectedValueOnce(new Error('transient'));
    await expect(f.manage('delete')).rejects.toThrow();
    expect(f.documents.get(f.ref)?.status).toBe('retired');
    await expect(f.manage('delete')).rejects.toThrow();
    const later = createAccountAdministration({ ...f, now: () => f.now() + 300001 });
    await later.manageAccount(
      { uid: f.uid, action: 'delete' },
      {
        ...f.context,
        auth: {
          ...f.context.auth,
          token: { ...f.context.auth.token, auth_time: (f.now() + 300001) / 1000 },
        },
      }
    );
    expect(f.users.has(f.uid)).toBe(false);
    expect(f.documents.get(f.ref)?.credentialOperation).toBeNull();
  });
});
