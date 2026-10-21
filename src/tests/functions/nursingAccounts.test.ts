import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { accountFixture } from './nursingAccounts.test-support';
const require = createRequire(import.meta.url);
const {
  createAccountAdministration,
} = require('../../../functions/lib/accounts/accountAdministration.js');
const {
  createAccountCredentials,
} = require('../../../functions/lib/accounts/accountCredentials.js');
const {
  hasCurrentAccountSession,
  normalizeRut,
  PROTECTED,
} = require('../../../functions/lib/accounts/accountPolicy.js');
const {
  resolveIndividualAccountRole,
} = require('../../../functions/lib/accounts/accountAccess.js');
const person = { name: 'Enfermera Sintética', rut: '11.111.111-1', identityVerified: true };
const password = 'Frase privada de prueba 729!';

const setup = async () => {
  const f = accountFixture();
  const admin = createAccountAdministration(f);
  const credentials = createAccountCredentials(f);
  const created = await admin.createAccount(person, f.context);
  const invitation = {
    ...created,
    ...(await admin.manageAccount({ uid: created.uid, action: 'invite' }, f.context)),
  };
  const ref = `hhr_account_access/${invitation.uid}`;
  const activate = () =>
    credentials.activateAccount(
      {
        rut: person.rut,
        recoveryEmail: 'nurse@example.invalid',
        activationToken: invitation.activationToken,
        password,
      },
      f.context
    );
  const session = () => ({
    auth: {
      uid: invitation.uid,
      token: {
        hhrAccountVersion: f.documents.get(ref)?.version,
        auth_time: f.now() / 1000,
        firebase: { sign_in_provider: 'password' },
      },
    },
  });
  return { ...f, admin, credentials, invitation, ref, activate, session };
};

describe('private nursing account lifecycle', () => {
  it('requires verified RUT, reserves one identity and never stores invitation/plain passwords in Firestore', async () => {
    const f = await setup();
    expect(normalizeRut(person.rut)).toBe('11111111-1');
    expect(() => normalizeRut('11111111-2')).toThrow();
    expect(f.documents.get(f.ref)?.status).toBe('pending');
    expect(f.users.get(f.invitation.uid)?.disabled).toBe(true);
    expect(JSON.stringify([...f.documents.values()])).not.toContain(
      f.invitation.activationToken.split('.')[1]
    );
    expect(JSON.stringify([...f.documents.values()])).not.toContain(password);
    await expect(f.admin.createAccount(person, f.context)).rejects.toMatchObject({
      code: 'already-exists',
    });
    expect(f.auth.createUser).toHaveBeenCalledTimes(1);
    expect([...f.documents.keys()].every(path => path.startsWith('hhr_account_'))).toBe(true);
  });

  it('activation requires the bound RUT and a chosen private password before any access', async () => {
    const f = await setup();
    expect(hasCurrentAccountSession(f.documents.get(f.ref), f.session(), f.now())).toBe(false);
    await expect(
      f.credentials.activateAccount(
        {
          rut: '22222222-2',
          recoveryEmail: 'nurse@example.invalid',
          activationToken: f.invitation.activationToken,
          password,
        },
        f.context
      )
    ).rejects.toThrow();
    await expect(f.activate()).resolves.toHaveProperty('credentialEmail');
    expect(hasCurrentAccountSession(f.documents.get(f.ref), f.session(), f.now())).toBe(true);
    expect(f.users.get(f.invitation.uid)?.password).toBe(password);
    await expect(f.activate()).rejects.toThrow();
  });

  it('only one concurrent redemption can change credentials', async () => {
    const f = await setup();
    const before = f.auth.updateUser.mock.calls.length;
    const results = await Promise.allSettled([f.activate(), f.activate()]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(f.auth.updateUser.mock.calls.slice(before)).toHaveLength(1);
  });

  it('expired invitations and RUT-derived passwords do not grant access', async () => {
    const f = await setup();
    const expired = createAccountCredentials({ ...f, now: () => f.now() + 3600001 });
    await expect(
      expired.activateAccount(
        {
          rut: person.rut,
          recoveryEmail: 'nurse@example.invalid',
          activationToken: f.invitation.activationToken,
          password,
        },
        f.context
      )
    ).rejects.toThrow();
    await expect(
      f.credentials.activateAccount(
        {
          rut: person.rut,
          recoveryEmail: 'nurse@example.invalid',
          activationToken: f.invitation.activationToken,
          password: '11111111',
        },
        f.context
      )
    ).rejects.toThrow();
    expect(f.documents.get(f.ref)?.status).toBe('pending');
  });

  it.each(['11.111.111-1', '11.111.111-1  ', '11 111 111 1'])(
    'rejects a formatted public RUT as the activation or replacement password: %s',
    async proposed => {
      const f = await setup();
      const beforeActivation = f.auth.updateUser.mock.calls.length;
      await expect(
        f.credentials.activateAccount(
          {
            rut: person.rut,
            recoveryEmail: 'nurse@example.invalid',
            activationToken: f.invitation.activationToken,
            password: proposed,
          },
          f.context
        )
      ).rejects.toMatchObject({ code: 'invalid-argument' });
      expect(f.documents.get(f.ref)?.status).toBe('pending');
      expect(f.auth.updateUser).toHaveBeenCalledTimes(beforeActivation);
      await f.activate();
      const prior = { ...f.documents.get(f.ref) };
      const calls = f.auth.updateUser.mock.calls.length;
      await expect(
        f.credentials.changeAccountPassword(
          { currentPassword: password, password: proposed, apiKey: 'synthetic-key' },
          f.session()
        )
      ).rejects.toMatchObject({ code: 'invalid-argument' });
      expect(f.documents.get(f.ref)).toEqual(prior);
      expect(f.auth.updateUser).toHaveBeenCalledTimes(calls);
    }
  );

  it('recovery invalidates old sessions immediately and never exposes an existing password', async () => {
    const f = await setup();
    await f.activate();
    const oldSession = f.session();
    const recovered = await f.admin.manageAccount(
      { uid: f.invitation.uid, action: 'invite' },
      f.context
    );
    expect(hasCurrentAccountSession(f.documents.get(f.ref), oldSession, f.now())).toBe(false);
    expect(recovered).not.toHaveProperty('password');
    await expect(
      f.credentials.signInWithRut({ rut: person.rut, password, apiKey: 'synthetic-key' }, f.context)
    ).rejects.toThrow();
    await f.credentials.activateAccount(
      {
        rut: person.rut,
        recoveryEmail: 'nurse@example.invalid',
        activationToken: recovered.activationToken,
        password: 'Otra frase privada 213!',
      },
      f.context
    );
    expect(hasCurrentAccountSession(f.documents.get(f.ref), oldSession, f.now())).toBe(false);
  });

  it('changing a password requires the current password and invalidates every previous session', async () => {
    const f = await setup();
    await f.activate();
    const session = f.session();
    await expect(
      f.credentials.changeAccountPassword(
        { currentPassword: 'wrong', password: 'Otra clave privada 1234!', apiKey: 'synthetic-key' },
        session
      )
    ).rejects.toThrow();
    expect(hasCurrentAccountSession(f.documents.get(f.ref), session, f.now())).toBe(true);
    await f.credentials.changeAccountPassword(
      { currentPassword: password, password: 'Otra clave privada 1234!', apiKey: 'synthetic-key' },
      session
    );
    expect(hasCurrentAccountSession(f.documents.get(f.ref), session, f.now())).toBe(false);
  });

  it('suspension during activation cannot reactivate the user or race a recovery password', async () => {
    const f = await setup();
    const update = f.auth.updateUser.getMockImplementation()!;
    f.auth.updateUser.mockImplementationOnce(async (...args) => {
      await f.admin.manageAccount({ uid: f.invitation.uid, action: 'suspend' }, f.context);
      await expect(
        f.admin.manageAccount({ uid: f.invitation.uid, action: 'invite' }, f.context)
      ).rejects.toThrow();
      return update(...args);
    });
    await expect(f.activate()).rejects.toThrow();
    expect(f.documents.get(f.ref)?.status).toBe('suspended');
    expect(f.users.get(f.invitation.uid)?.disabled).toBe(true);
  });

  it('managed access ignores forged role claims and tokens from the wrong provider', async () => {
    const f = await setup();
    await f.activate();
    const session = f.session();
    expect(
      hasCurrentAccountSession(
        f.documents.get(f.ref),
        {
          auth: {
            ...session.auth,
            token: { ...session.auth.token, hhrAccountVersion: 0, role: 'admin' },
          },
        },
        f.now()
      )
    ).toBe(false);
    expect(
      hasCurrentAccountSession(
        f.documents.get(f.ref),
        {
          auth: {
            ...session.auth,
            token: { ...session.auth.token, firebase: { sign_in_provider: 'custom' } },
          },
        },
        f.now()
      )
    ).toBe(false);
    expect(hasCurrentAccountSession(f.documents.get(f.ref), session, f.now() + 43200001)).toBe(
      false
    );
  });

  it('nurses cannot administer users and the two Google identities cannot be retired', async () => {
    const f = await setup();
    await f.activate();
    await expect(f.admin.listAccounts({}, f.session())).rejects.toThrow();
    await expect(
      f.admin.manageAccount({ uid: 'google-admin', action: 'retire' }, f.context)
    ).rejects.toThrow();
  });

  it('never grants a legacy email role to an unmanaged password identity before cutover', async () => {
    const f = await setup();
    expect(
      await resolveIndividualAccountRole(f.firestore, {
        auth: {
          uid: 'unmanaged-password',
          token: {
            email: 'legacy@example.invalid',
            role: 'admin',
            firebase: { sign_in_provider: 'password' },
          },
        },
      })
    ).toBe('unauthorized');
  });

  it('cutover requires both verified Google providers and preserves every historical document', async () => {
    const f = await setup();
    f.documents.set('hospitals/hanga_roa/dailyRecords/2025-01-01', {
      authorUid: 'old-author',
      immutable: true,
    });
    const original = structuredClone(
      f.documents.get('hospitals/hanga_roa/dailyRecords/2025-01-01')
    );
    await expect(f.admin.enableIndividualOnly({}, f.context)).rejects.toThrow();
    Object.keys(PROTECTED).forEach((email, index) =>
      f.users.set(index ? 'shared-google' : 'google-admin', {
        uid: index ? 'shared-google' : 'google-admin',
        email,
        emailVerified: true,
        providerData: [{ providerId: 'google.com' }],
      })
    );
    await f.admin.enableIndividualOnly({}, f.context);
    expect(await resolveIndividualAccountRole(f.firestore, f.context)).toBe('admin');
    expect(
      await resolveIndividualAccountRole(f.firestore, {
        auth: { uid: 'old-author', token: { email: 'legacy@example.invalid', role: 'admin' } },
      })
    ).toBe('unauthorized');
    expect(f.documents.get('hospitals/hanga_roa/dailyRecords/2025-01-01')).toEqual(original);
    expect(f.auth).not.toHaveProperty('deleteUser');
  });
  it('keeps ambiguous password failures closed until a delayed administrator recovery', async () => {
    const f = await setup();
    f.auth.updateUser.mockRejectedValueOnce(new Error('provider unavailable'));
    await expect(f.activate()).rejects.toThrow();
    expect(f.documents.get(f.ref)?.status).toBe('setting_password');
    expect(hasCurrentAccountSession(f.documents.get(f.ref), f.session(), f.now())).toBe(false);
    await expect(
      f.admin.manageAccount({ uid: f.invitation.uid, action: 'recover' }, f.context)
    ).rejects.toThrow();
    const later = createAccountAdministration({ ...f, now: () => f.now() + 300001 });
    const invitation = await later.manageAccount(
      { uid: f.invitation.uid, action: 'recover' },
      f.context
    );
    expect(f.documents.get(f.ref)?.status).toBe('pending');
    expect(f.auth.createUser).toHaveBeenCalledTimes(1);
    await f.credentials.activateAccount(
      {
        rut: person.rut,
        recoveryEmail: 'nurse@example.invalid',
        activationToken: invitation.activationToken,
        password,
      },
      f.context
    );
    expect(f.documents.get(f.ref)?.status).toBe('active');
  });

  it('repairs a failed provision using its reserved identity without deleting or duplicating it', async () => {
    const f = accountFixture();
    const admin = createAccountAdministration(f);
    f.auth.createUser.mockRejectedValueOnce(new Error('network unavailable'));
    await expect(admin.createAccount(person, f.context)).rejects.toThrow();
    const access = [...f.documents.keys()].find(key => key.startsWith('hhr_account_access/'))!;
    const uid = access.split('/')[1];
    const later = createAccountAdministration({ ...f, now: () => f.now() + 300001 });
    await later.manageAccount({ uid, action: 'recover' }, f.context);
    expect(f.users.size).toBe(1);
    expect(f.users.get(uid)?.disabled).toBe(true);
    expect(f.documents.get(access)?.status).toBe('pending');
    expect(f.auth.createUser.mock.calls.map(args => args[0].uid)).toEqual([uid, uid]);
  });

  it('keeps a rejected activation locked through its final provider disable', async () => {
    const f = await setup();
    const update = f.auth.updateUser.getMockImplementation()!;
    f.auth.updateUser.mockImplementationOnce(async (...args) => {
      await f.admin.manageAccount({ uid: f.invitation.uid, action: 'suspend' }, f.context);
      return update(...args);
    });
    // The final disable still owns the credential lock; the next invitation cannot race it.
    f.auth.updateUser.mockImplementation(async (uid, data) => {
      if (data.disabled === true) {
        await expect(f.admin.manageAccount({ uid, action: 'invite' }, f.context)).rejects.toThrow();
      }
      return update(uid, data);
    });
    await expect(f.activate()).rejects.toThrow();
    expect(f.documents.get(f.ref)?.credentialOperation).toBeNull();
    expect(f.documents.get(f.ref)?.status).toBe('suspended');
  });
  it('fresh logins use the version published by revocation and never overwrite newer claims', async () => {
    const f = await setup();
    await f.activate();
    const oldSession = f.session();
    await f.admin.manageAccount({ uid: f.invitation.uid, action: 'revoke' }, f.context);
    const expected = f.documents.get(f.ref)?.version;
    expect(f.users.get(f.invitation.uid)?.customClaims).toMatchObject({
      hhrAccountVersion: expected,
    });
    const calls = f.auth.setCustomUserClaims.mock.calls.length;
    await f.credentials.signInWithRut(
      { rut: person.rut, password, apiKey: 'synthetic-key' },
      f.context
    );
    expect(f.auth.setCustomUserClaims).toHaveBeenCalledTimes(calls);
    expect(hasCurrentAccountSession(f.documents.get(f.ref), oldSession, f.now())).toBe(false);
    expect(hasCurrentAccountSession(f.documents.get(f.ref), f.session(), f.now())).toBe(true);
  });
});
