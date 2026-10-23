import { createRequire } from 'node:module';
import { describe, it, expect, vi } from 'vitest';
import { accountFixture } from './nursingAccounts.test-support';
const require = createRequire(import.meta.url);
const {
  createAccountAdministration,
} = require('../../../functions/lib/accounts/accountAdministration.js');
const {
  createAccountCredentials,
} = require('../../../functions/lib/accounts/accountCredentials.js');
const { createAccountRecovery } = require('../../../functions/lib/accounts/accountRecovery.js');
const {
  assertPassword,
  normalizeRut,
  hasCurrentAccountSession,
} = require('../../../functions/lib/accounts/accountPolicy.js');
const person = { name: 'Persona Sintética', rut: '111111111', identityVerified: true };
const setup = async (activate = true) => {
  const f = accountFixture();
  const admin = createAccountAdministration(f);
  const credentials = createAccountCredentials(f);
  const created = await admin.createAccount(person, f.context);
  const ref = `hhr_account_access/${created.uid}`;
  const sendMail = vi.fn(async (_mail: { email: string; code: string }) => undefined);
  const recovery = createAccountRecovery({
    ...f,
    sendMail,
    finalizePassword: credentials.finalizePassword,
  });
  const initial = await credentials.signInWithRut(
    { rut: person.rut, password: '11111111' },
    f.context
  );
  if (activate)
    await credentials.activateAccount(
      {
        rut: person.rut,
        activationToken: initial.activationToken,
        password: 'Clave1',
        recoveryEmail: 'nurse@example.invalid',
      },
      f.context
    );
  const request = async () => {
    const { challengeId } = await recovery.requestRecovery({ rut: person.rut }, f.context);
    await recovery.deliverRecovery(challengeId);
    return {
      rut: person.rut,
      challengeId,
      code: sendMail.mock.calls.at(-1)![0].code,
      password: 'Nueva1',
    };
  };
  return { ...f, admin, credentials, created, ref, initial, sendMail, recovery, request };
};

describe('RUT initial credentials and email recovery', () => {
  it.each(['suspend', 'retire'])(
    'preserves %s while initial account creation is in flight',
    async action => {
      const f = accountFixture();
      const admin = createAccountAdministration(f);
      const credentials = createAccountCredentials(f);
      f.auth.createUser.mockImplementationOnce(async data => {
        f.users.set(data.uid, { ...data });
        await admin.manageAccount({ uid: data.uid, action }, f.context);
        return data;
      });
      await expect(admin.createAccount(person, f.context)).rejects.toThrow();
      const uid = f.auth.createUser.mock.calls[0][0].uid;
      expect(f.documents.get(`hhr_account_access/${uid}`)).toMatchObject({
        status: action === 'suspend' ? 'suspended' : 'retired',
        version: 2,
        credentialOperation: null,
      });
      expect(f.documents.get(`hhr_account_access/${uid}`)?.initialPasswordEnabled).not.toBe(true);
      expect(f.users.get(uid)?.disabled).toBe(true);
      await expect(
        credentials.signInWithRut({ rut: person.rut, password: '11111111' }, f.context)
      ).rejects.toThrow();
    }
  );
  it('normalizes a k username and enforces only provider length, uppercase and digit', () => {
    expect(normalizeRut('17752753k')).toBe('17752753-K');
    expect(() => assertPassword('Abcde1')).not.toThrow();
    for (const value of ['abcde1', 'ABCDEF', 'A1', '', 'A'.repeat(129) + '1'])
      expect(() => assertPassword(value)).toThrow();
  });
  it('initial password grants setup only, then is permanently invalidated without changing UID or clinical data', async () => {
    const f = await setup(false);
    expect(f.created.username).toBe('111111111');
    expect(f.initial).not.toHaveProperty('credentialEmail');
    expect(f.users.get(f.created.uid)?.disabled).toBe(true);
    expect(f.passwordVerifier).not.toHaveBeenCalled();
    await expect(
      f.credentials.signInWithRut({ rut: person.rut, password: '12345678' }, f.context)
    ).rejects.toThrow();
    await expect(
      f.credentials.activateAccount(
        { rut: person.rut, activationToken: f.initial.activationToken, password: 'Clave1' },
        f.context
      )
    ).rejects.toThrow();
    await f.credentials.activateAccount(
      {
        rut: person.rut,
        activationToken: f.initial.activationToken,
        password: 'Clave1',
        recoveryEmail: 'nurse@example.invalid',
      },
      f.context
    );
    await expect(
      f.credentials.signInWithRut({ rut: person.rut, password: '11111111' }, f.context)
    ).rejects.toThrow();
    expect(f.documents.get(`hhr_account_private/${f.created.uid}`)?.recoveryEmail).toBe(
      'nurse@example.invalid'
    );
    expect([...f.documents.keys()].every(key => key.startsWith('hhr_account_'))).toBe(true);
  });
  it('sends to the registered email only and consumes a recovery code exactly once, revoking the old session', async () => {
    const f = await setup();
    const oldSession = {
      auth: {
        token: {
          hhrAccountVersion: f.documents.get(f.ref)?.version,
          auth_time: f.now() / 1000,
          firebase: { sign_in_provider: 'password' },
        },
      },
    };
    const payload = await f.request();
    expect(f.sendMail.mock.calls[0][0].email).toBe('nurse@example.invalid');
    expect(JSON.stringify([...f.documents.values()])).not.toContain(payload.code);
    const results = await Promise.allSettled([
      f.recovery.resetPassword(payload, f.context),
      f.recovery.resetPassword(payload, f.context),
    ]);
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    expect(f.users.get(f.created.uid)?.password).toBe('Nueva1');
    expect(hasCurrentAccountSession(f.documents.get(f.ref), oldSession, f.now())).toBe(false);
    expect(f.documents.get(`hhr_account_recovery/${payload.challengeId}`)?.status).toBe('consumed');
  });
  it('uses the same public storage path for existing and unknown RUTs without waiting for mail', async () => {
    const f = await setup();
    const collection = vi.spyOn(f.firestore, 'collection');
    const known = await f.recovery.requestRecovery({ rut: person.rut }, f.context);
    const knownCollections = collection.mock.calls.map(([name]) => name);
    collection.mockClear();
    const unknown = await f.recovery.requestRecovery({ rut: '222222222' }, f.context);
    expect(collection.mock.calls.map(([name]) => name)).toEqual(knownCollections);
    expect(knownCollections).not.toContain('hhr_account_index');
    expect(knownCollections).not.toContain('hhr_account_access');
    expect(f.sendMail).not.toHaveBeenCalled();
    for (const { challengeId } of [known, unknown])
      expect(f.documents.get(`hhr_account_recovery/${challengeId}`)).toMatchObject({
        status: 'requested',
      });
    let finishMail!: () => void;
    f.sendMail.mockImplementationOnce(
      () =>
        new Promise<undefined>(resolve => {
          finishMail = () => resolve(undefined);
        })
    );
    const delivery = f.recovery.deliverRecovery(known.challengeId);
    await vi.waitFor(() => expect(f.sendMail).toHaveBeenCalledTimes(1));
    await expect(f.recovery.requestRecovery({ rut: person.rut }, f.context)).resolves.toEqual({
      challengeId: expect.any(String),
    });
    finishMail();
    await delivery;
  });
  it('claims a delivery once across duplicate events and never sends expired queued requests', async () => {
    const f = await setup();
    const { challengeId } = await f.recovery.requestRecovery({ rut: person.rut }, f.context);
    await Promise.all([
      f.recovery.deliverRecovery(challengeId),
      f.recovery.deliverRecovery(challengeId),
    ]);
    await f.recovery.deliverRecovery(challengeId);
    expect(f.sendMail).toHaveBeenCalledTimes(1);
    const expired = await f.recovery.requestRecovery({ rut: person.rut }, f.context);
    const worker = createAccountRecovery({ ...f, now: () => f.now() + 600001 });
    await worker.deliverRecovery(expired.challengeId);
    expect(f.documents.get(`hhr_account_recovery/${expired.challengeId}`)?.status).toBe('expired');
    expect(f.sendMail).toHaveBeenCalledTimes(1);
  });
  it('keeps unavailable recovery attempts equivalent to wrong codes, including exhaustion', async () => {
    const f = await setup();
    const known = await f.request();
    const unknown = await f.recovery.requestRecovery({ rut: '222222222' }, f.context);
    await f.recovery.deliverRecovery(unknown.challengeId);
    const collection = vi.spyOn(f.firestore, 'collection');
    const wrong = known.code === '00000000' ? '11111111' : '00000000';
    for (let attempt = 1; attempt <= 6; attempt++) {
      collection.mockClear();
      await expect(
        f.recovery.resetPassword({ ...known, code: wrong }, f.context)
      ).rejects.toThrow();
      const knownReads = collection.mock.calls.map(([name]) => name);
      collection.mockClear();
      await expect(
        f.recovery.resetPassword(
          { ...unknown, rut: '222222222', code: wrong, password: 'Nueva1' },
          f.context
        )
      ).rejects.toThrow();
      expect(collection.mock.calls.map(([name]) => name)).toEqual(knownReads);
      for (const { challengeId } of [known, unknown])
        expect(f.documents.get(`hhr_account_recovery/${challengeId}`)?.attempts).toBe(
          Math.min(attempt, 5)
        );
    }
    expect(f.users.get(f.created.uid)?.password).toBe('Clave1');
  });
  it('persists five wrong attempts and will not accept the correct code afterwards', async () => {
    const f = await setup();
    const payload = await f.request();
    const wrong = payload.code === '00000000' ? '11111111' : '00000000';
    for (let i = 0; i < 5; i++)
      await expect(
        f.recovery.resetPassword({ ...payload, code: wrong }, f.context)
      ).rejects.toThrow();
    expect(f.documents.get(`hhr_account_recovery/${payload.challengeId}`)?.attempts).toBe(5);
    await expect(f.recovery.resetPassword(payload, f.context)).rejects.toThrow();
    expect(f.users.get(f.created.uid)?.password).toBe('Clave1');
  });
  it('denies expired, cross-RUT and suspended-account recovery without changing credentials', async () => {
    const f = await setup();
    const payload = await f.request();
    const expired = createAccountRecovery({
      ...f,
      now: () => f.now() + 600001,
      finalizePassword: f.credentials.finalizePassword,
    });
    await expect(expired.resetPassword(payload, f.context)).rejects.toThrow();
    await expect(
      f.recovery.resetPassword({ ...payload, rut: '222222222' }, f.context)
    ).rejects.toThrow();
    await f.admin.manageAccount({ uid: f.created.uid, action: 'suspend' }, f.context);
    await expect(f.recovery.resetPassword(payload, f.context)).rejects.toThrow();
    const suspended = await f.recovery.requestRecovery({ rut: person.rut }, f.context);
    await f.recovery.deliverRecovery(suspended.challengeId);
    expect(f.sendMail).toHaveBeenCalledTimes(1);
    expect(f.documents.get(f.ref)?.status).toBe('suspended');
  });
  it('uses a generic response for unknown accounts and never discloses addresses or delivery errors', async () => {
    const f = await setup();
    const unknown = await f.recovery.requestRecovery({ rut: '222222222' }, f.context);
    await f.recovery.deliverRecovery(unknown.challengeId);
    expect(unknown).toEqual({
      challengeId: expect.any(String),
    });
    expect(f.sendMail).not.toHaveBeenCalled();
    f.sendMail.mockRejectedValueOnce(new Error('private-provider-detail'));
    const result = await f.recovery.requestRecovery(
      { rut: person.rut, email: 'attacker@example.invalid' },
      f.context
    );
    expect(result).toEqual({ challengeId: expect.any(String) });
    await f.recovery.deliverRecovery(result.challengeId);
    expect(f.documents.get(`hhr_account_recovery/${result.challengeId}`)?.status).toBe(
      'delivery_failed'
    );
    expect(f.sendMail.mock.calls[0][0].email).toBe('nurse@example.invalid');
  });
  it('a lost provider response fails closed and stale codes cannot repair or override the lock', async () => {
    const f = await setup();
    const payload = await f.request();
    f.auth.updateUser.mockRejectedValueOnce(new Error('lost-response'));
    await expect(f.recovery.resetPassword(payload, f.context)).rejects.toThrow();
    expect(f.documents.get(f.ref)?.status).toBe('setting_password');
    expect(f.documents.get(f.ref)?.credentialOperation).toBeTruthy();
    await expect(f.recovery.resetPassword(payload, f.context)).rejects.toThrow();
  });
  it('invalidates all other outstanding codes when a password changes', async () => {
    const f = await setup();
    const first = await f.request();
    const second = await f.request();
    await f.recovery.resetPassword(first, f.context);
    await expect(f.recovery.resetPassword(second, f.context)).rejects.toThrow();
  });
});
