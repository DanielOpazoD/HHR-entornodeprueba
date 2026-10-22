import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { initializeApp, deleteApp, type App } from 'firebase-admin/app';
import { getAuth, type Auth, type DecodedIdToken } from 'firebase-admin/auth';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { getTodayISO } from '@/utils/dateCoreUtils';
const require = createRequire(import.meta.url);
const {
  createAccountAdministration,
} = require('../../../functions/lib/accounts/accountAdministration.js');
const {
  createAccountCredentials,
} = require('../../../functions/lib/accounts/accountCredentials.js');
const { createAuthHelpers } = require('../../../functions/lib/auth/authHelpersFactory.js');
const rulesToken = (
  token: DecodedIdToken
): NonNullable<Parameters<RulesTestEnvironment['authenticatedContext']>[1]> => {
  const provider = token.firebase.sign_in_provider;
  if (provider !== 'password' && provider !== 'google.com')
    throw new Error('Unexpected synthetic provider');
  return {
    email: token.email,
    email_verified: token.email_verified,
    auth_time: token.auth_time,
    role: token.role,
    hhrAccountVersion: token.hhrAccountVersion,
    firebase: { sign_in_provider: provider },
  };
};
const enabled = Boolean(
  process.env.FIREBASE_AUTH_EMULATOR_HOST &&
  process.env.FIRESTORE_EMULATOR_HOST &&
  process.env.FIREBASE_STORAGE_EMULATOR_HOST
);
(enabled ? describe : describe.skip)(
  'individual accounts with real local Auth, Firestore and Storage',
  () => {
    const projectId = 'demo-hhr-nursing-accounts';
    const adminEmail = 'daniel.opazo@hospitalhangaroa.cl';
    const sharedEmail = 'hospitalizados@hospitalhangaroa.cl';
    const password = 'Synthetic private phrase 726!';
    let app: App;
    let auth: Auth;
    let firestore: Firestore;
    let rules: RulesTestEnvironment;
    beforeEach(() => {
      // Anchor fixture dates once, near the Auth emulator clock; keep transport timers real.
      vi.useFakeTimers({ toFake: ['Date'] });
    });
    afterEach(() => {
      vi.useRealTimers();
    });
    const host = (name: string) => {
      const value = process.env[name] || '';
      if (!/^(127\.0\.0\.1|localhost):\d+$/.test(value))
        throw new Error('Local emulators required');
      const [hostname, port] = value.split(':');
      return { host: hostname, port: Number(port) };
    };
    const requestAuth = async (action: string, data: Record<string, unknown>) => {
      host('FIREBASE_AUTH_EMULATOR_HOST');
      const result = await fetch(
        `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:${action}?key=synthetic-key`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
          signal: AbortSignal.timeout(15000),
        }
      );
      if (!result.ok) throw new Error(`Synthetic Auth request failed: ${result.status}`);
      return result.json() as Promise<{ idToken: string; localId: string }>;
    };
    const context = async (token: string) => ({
      auth: {
        uid: (await auth.verifyIdToken(token, true)).uid,
        token: await auth.verifyIdToken(token, true),
      },
      rawRequest: { ip: '127.0.0.1' },
    });
    const google = async (email: string, sub: string) => {
      const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
      // Auth emulator accepts synthetic provider assertions; no real Google account is contacted.
      const idToken = `${encode({ alg: 'none', typ: 'JWT' })}.${encode({ sub, email, email_verified: true, iss: 'https://accounts.google.com', aud: 'synthetic-client', iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 3600 })}.`;
      const result = await requestAuth('signInWithIdp', {
        postBody: new URLSearchParams({ providerId: 'google.com', id_token: idToken }).toString(),
        requestUri: 'http://localhost',
        returnSecureToken: true,
      });
      return context(result.idToken);
    };
    beforeAll(async () => {
      app = initializeApp({ projectId }, 'nursing-accounts-emulator');
      auth = getAuth(app);
      firestore = getFirestore(app);
      rules = await initializeTestEnvironment({
        projectId,
        firestore: {
          ...host('FIRESTORE_EMULATOR_HOST'),
          rules: readFileSync('firestore.rules', 'utf8'),
        },
        storage: {
          ...host('FIREBASE_STORAGE_EMULATOR_HOST'),
          rules: readFileSync('storage.rules', 'utf8'),
        },
      });
    });
    afterAll(async () => {
      await rules?.cleanup();
      await firestore?.terminate();
      if (app) await deleteApp(app);
    });
    it('admin edits, resets, disables and deletes only the account while viewer rules and historical authors remain intact', async () => {
      const adminContext = await google(adminEmail, 'synthetic-admin');
      await firestore.doc('config/roles').set({ [adminEmail]: 'admin' });
      const helpers = createAuthHelpers({ auth, firestore });
      const administration = createAccountAdministration({ auth, firestore, helpers });
      const credentials = createAccountCredentials({ auth, firestore });
      const { uid } = await administration.createAccount(
        { name: 'Synthetic viewer', role: 'viewer', rut: '333333333', identityVerified: true },
        adminContext
      );
      const initial = await credentials.signInWithRut(
        { rut: '333333333', password: '33333333' },
        {}
      );
      await credentials.activateAccount(
        {
          rut: '333333333',
          password,
          recoveryEmail: 'viewer@example.invalid',
          activationToken: initial.activationToken,
        },
        {}
      );
      const signed = await requestAuth('signInWithPassword', {
        email: `${uid}@accounts.hhr.invalid`,
        password,
        returnSecureToken: true,
      });
      const viewerContext = await context(signed.idToken);
      expect(viewerContext.auth.token.role).toBe('viewer');
      const history = firestore.doc('hospitals/hanga_roa/dailyRecords/2025-01-02');
      await history.set({
        date: '2025-01-02',
        authorUid: uid,
        beds: {},
        notes: 'untouched synthetic history',
      });
      const before = await history.get();
      const viewer = rules.authenticatedContext(uid, rulesToken(viewerContext.auth.token));
      await assertSucceeds(viewer.firestore().doc(history.path).get());
      await assertFails(viewer.firestore().doc(history.path).update({ notes: 'forbidden' }));
      await expect(administration.listAccounts({}, viewerContext)).rejects.toThrow();
      const manage = (action: string, extra = {}) =>
        administration.manageAccount({ uid, action, ...extra }, adminContext);
      await manage('update', { name: 'Synthetic updated viewer', role: 'doctor_urgency' });
      expect((await auth.getUser(uid)).customClaims?.role).toBe('doctor_urgency');
      await assertFails(viewer.firestore().doc(history.path).get());
      expect(
        (await administration.listAccounts({}, adminContext)).accounts.find(
          (a: { uid: string }) => a.uid === uid
        ).recoveryEmail
      ).toBe('viewer@example.invalid');
      await manage('suspend');
      expect((await auth.getUser(uid)).disabled).toBe(true);
      await manage('enable');
      expect((await auth.getUser(uid)).disabled).toBe(false);
      await credentials.signInWithRut({ rut: '333333333', password, apiKey: 'synthetic-key' }, {});
      await manage('reset');
      await expect(
        credentials.signInWithRut({ rut: '333333333', password, apiKey: 'synthetic-key' }, {})
      ).rejects.toThrow();
      expect(
        (await credentials.signInWithRut({ rut: '333333333', password: '33333333' }, {}))
          .requiresSetup
      ).toBe(true);
      await manage('delete');
      await expect(auth.getUser(uid)).rejects.toMatchObject({ code: 'auth/user-not-found' });
      expect((await firestore.doc(`hhr_account_access/${uid}`).get()).data()?.status).toBe(
        'retired'
      );
      const after = await history.get();
      expect(after.data()).toEqual(before.data());
      expect(after.updateTime?.isEqual(before.updateTime!)).toBe(true);
    }, 60000);
    it('privately activates, authenticates, rotates and revokes across every boundary while preserving Google and history', async () => {
      const adminContext = await google(adminEmail, 'synthetic-admin');
      const sharedContext = await google(sharedEmail, 'synthetic-shared');
      await firestore.doc('config/roles').set({
        [adminEmail]: 'admin',
        [sharedEmail]: 'nurse_hospital',
        'old@example.invalid': 'admin',
      });
      const history = firestore.doc('hospitals/hanga_roa/dailyRecords/2025-01-01');
      await history.set({ date: '2025-01-01', authorUid: 'legacy-author', beds: {} });
      const before = await history.get();
      const todayDate = getTodayISO();
      const today = firestore.doc(`hospitals/hanga_roa/dailyRecords/${todayDate}`);
      await today.set({
        date: todayDate,
        dateTimestamp: Date.parse(`${todayDate}T00:00:00Z`),
        beds: {},
        notes: 'synthetic current record',
      });
      const helpers = createAuthHelpers({ auth, firestore });
      const administration = createAccountAdministration({ auth, firestore, helpers });
      const credentials = createAccountCredentials({ auth, firestore });
      // Enabling password sign-in must not let a self-registration inherit an old email role.
      const unmanaged = await requestAuth('signUp', {
        email: 'old@example.invalid',
        password,
        returnSecureToken: true,
      });
      const unmanagedContext = await context(unmanaged.idToken);
      expect(await helpers.resolveRoleForEmail('old@example.invalid', unmanagedContext)).toBe(
        'unauthorized'
      );
      expect(await helpers.assignRole(await auth.getUser(unmanaged.localId))).toBe('unauthorized');
      expect((await auth.getUser(unmanaged.localId)).customClaims?.role).toBeUndefined();
      const adminRules = rules.authenticatedContext(
        adminContext.auth.uid,
        rulesToken(adminContext.auth.token)
      );
      await assertSucceeds(
        adminRules.firestore().doc('config/roles').update({ 'old@example.invalid': 'admin' })
      );
      await assertSucceeds(
        Promise.resolve(
          adminRules
            .storage()
            .ref('reminders/unmanaged.png')
            .put(new Uint8Array([1]), { contentType: 'image/png' })
        )
      );
      const clinicalFile = (client: ReturnType<RulesTestEnvironment['authenticatedContext']>) =>
        client.storage().ref('censo-diario/nursing-session.txt');
      const writeClinicalFile = (
        client: ReturnType<RulesTestEnvironment['authenticatedContext']>
      ) =>
        Promise.resolve(
          clinicalFile(client).put(new Uint8Array([1]), { contentType: 'text/plain' })
        );
      const sharedRules = rules.authenticatedContext(
        sharedContext.auth.uid,
        rulesToken(sharedContext.auth.token)
      );
      const legacyGoogle = rules.authenticatedContext('legacy-author', {
        email: 'old@example.invalid',
        role: 'admin',
        firebase: { sign_in_provider: 'google.com' },
      });
      for (const client of [adminRules, sharedRules, legacyGoogle]) {
        await assertSucceeds(writeClinicalFile(client));
        await assertSucceeds(clinicalFile(client).getMetadata());
      }
      const unmanagedRules = rules.authenticatedContext(
        unmanaged.localId,
        rulesToken(unmanagedContext.auth.token)
      );
      await assertFails(unmanagedRules.firestore().doc(history.path).get());
      await assertFails(unmanagedRules.firestore().doc(today.path).update({ notes: 'denied' }));
      await assertFails(
        Promise.resolve(
          unmanagedRules
            .storage()
            .ref('reminders/unmanaged.png')
            .put(new Uint8Array([1]), { contentType: 'image/png' })
        )
      );
      await assertFails(clinicalFile(unmanagedRules).getMetadata());
      await assertFails(writeClinicalFile(unmanagedRules));
      const createdAccount = await administration.createAccount(
        { name: 'Enfermera Sintética', rut: '11.111.111-1', identityVerified: true },
        adminContext
      );
      const invitation = {
        ...createdAccount,
        ...(await credentials.signInWithRut({ rut: '111111111', password: '11111111' }, {})),
      };
      expect(invitation.requiresSetup).toBe(true);
      expect((await auth.getUser(invitation.uid)).disabled).toBe(true);
      const activation = await credentials.activateAccount(
        {
          rut: '11111111-1',
          recoveryEmail: 'nurse@example.invalid',
          activationToken: invitation.activationToken,
          password,
        },
        { rawRequest: { ip: '127.0.0.1' } }
      );
      await expect(
        credentials.activateAccount(
          {
            rut: '11111111-1',
            recoveryEmail: 'nurse@example.invalid',
            activationToken: invitation.activationToken,
            password,
          },
          {}
        )
      ).rejects.toThrow();
      const signIn = await credentials.signInWithRut(
        { rut: '11.111.111-1', password, apiKey: 'synthetic-key' },
        {}
      );
      expect(signIn.credentialEmail).toBe(activation.credentialEmail);
      const signed = await requestAuth('signInWithPassword', {
        email: signIn.credentialEmail,
        password,
        returnSecureToken: true,
      });
      const nurseContext = await context(signed.idToken);
      expect(await helpers.resolveRoleForEmail(signIn.credentialEmail, nurseContext)).toBe(
        'nurse_hospital'
      );
      const nurse = rules.authenticatedContext(invitation.uid, rulesToken(nurseContext.auth.token));
      await expect(administration.listAccounts({}, nurseContext)).rejects.toMatchObject({
        code: 'permission-denied',
      });
      await assertSucceeds(nurse.firestore().doc(history.path).get());
      await assertSucceeds(nurse.firestore().doc(today.path).update({ notes: 'active nurse' }));
      await assertFails(nurse.firestore().doc(`hhr_account_private/${invitation.uid}`).get());
      await assertFails(
        nurse
          .firestore()
          .doc('config/roles')
          .set({ [signIn.credentialEmail]: 'admin' })
      );
      const avatar = nurse.storage().ref(`user-avatars/${invitation.uid}/profile.png`);
      await assertSucceeds(
        Promise.resolve(avatar.put(new Uint8Array([137, 80, 78, 71]), { contentType: 'image/png' }))
      );
      await assertSucceeds(writeClinicalFile(nurse));
      await assertSucceeds(clinicalFile(nurse).getMetadata());
      const managedGoogle = rules.authenticatedContext(invitation.uid, {
        email: signIn.credentialEmail,
        role: 'nurse_hospital',
        auth_time: Math.floor(Date.now() / 1000),
        firebase: { sign_in_provider: 'google.com' },
      });
      await assertFails(clinicalFile(managedGoogle).getMetadata());
      await assertFails(writeClinicalFile(managedGoogle));
      const missingManaged = rules.authenticatedContext('hhrn_missing-account', {
        ...rulesToken(nurseContext.auth.token),
      });
      await assertFails(clinicalFile(missingManaged).getMetadata());
      const nextPassword = 'Another private synthetic phrase 299!';
      await credentials.changeAccountPassword(
        { password: nextPassword, currentPassword: password, apiKey: 'synthetic-key' },
        nurseContext
      );
      expect(await helpers.resolveRoleForEmail(signIn.credentialEmail, nurseContext)).toBe(
        'unauthorized'
      );
      await assertFails(nurse.firestore().doc(history.path).get());
      await assertFails(nurse.firestore().doc(today.path).update({ notes: 'stale version' }));
      await assertFails(avatar.getMetadata());
      await assertFails(clinicalFile(nurse).getMetadata());
      await assertFails(writeClinicalFile(nurse));
      await expect(
        credentials.signInWithRut({ rut: '11111111-1', password, apiKey: 'synthetic-key' }, {})
      ).rejects.toThrow();
      await credentials.signInWithRut(
        { rut: '11111111-1', password: nextPassword, apiKey: 'synthetic-key' },
        {}
      );
      const current = await requestAuth('signInWithPassword', {
        email: signIn.credentialEmail,
        password: nextPassword,
        returnSecureToken: true,
      });
      const currentContext = await context(current.idToken);
      const currentNurse = rules.authenticatedContext(
        invitation.uid,
        rulesToken(currentContext.auth.token)
      );
      await assertSucceeds(
        currentNurse.firestore().doc(today.path).update({ notes: 'new session' })
      );
      const expiredNurse = rules.authenticatedContext(invitation.uid, {
        ...rulesToken(currentContext.auth.token),
        auth_time: Math.floor(Date.now() / 1000) - 43201,
      });
      await assertFails(expiredNurse.firestore().doc(today.path).update({ notes: 'expired' }));
      await assertFails(clinicalFile(expiredNurse).getMetadata());
      const accountRef = firestore.doc(`hhr_account_access/${invitation.uid}`);
      for (const status of ['pending', 'provisioning', 'setting_password', 'retired']) {
        await accountRef.update({ status });
        await assertFails(currentNurse.firestore().doc(today.path).update({ notes: status }));
        await assertFails(clinicalFile(currentNurse).getMetadata());
      }
      await accountRef.update({ status: 'active', credentialOperation: 'synthetic-pending-write' });
      await assertFails(currentNurse.firestore().doc(today.path).update({ notes: 'locked' }));
      await assertFails(writeClinicalFile(currentNurse));
      await accountRef.update({ credentialOperation: null });
      await administration.manageAccount({ uid: invitation.uid, action: 'suspend' }, adminContext);
      expect(await helpers.resolveRoleForEmail(signIn.credentialEmail, currentContext)).toBe(
        'unauthorized'
      );
      await assertFails(
        rules
          .authenticatedContext(invitation.uid, rulesToken(currentContext.auth.token))
          .firestore()
          .doc(history.path)
          .get()
      );
      await assertFails(currentNurse.firestore().doc(today.path).update({ notes: 'suspended' }));
      expect((await today.get()).data()?.notes).toBe('new session');
      await assertFails(clinicalFile(currentNurse).getMetadata());
      await administration.enableIndividualOnly({}, adminContext);
      for (const client of [adminRules, sharedRules]) {
        await assertSucceeds(writeClinicalFile(client));
        await assertSucceeds(clinicalFile(client).getMetadata());
      }
      await assertFails(clinicalFile(legacyGoogle).getMetadata());
      await assertFails(writeClinicalFile(legacyGoogle));
      const impostor = rules.authenticatedContext('imposter', rulesToken(adminContext.auth.token));
      await assertFails(clinicalFile(impostor).getMetadata());
      await assertSucceeds(adminRules.firestore().doc('config/roles').get());
      await assertFails(
        adminRules.firestore().doc('config/roles').update({ 'old@example.invalid': 'admin' })
      );
      for (const ctx of [adminContext, sharedContext]) {
        await assertSucceeds(
          rules
            .authenticatedContext(ctx.auth.uid, rulesToken(ctx.auth.token))
            .firestore()
            .doc(history.path)
            .get()
        );
        expect(await helpers.resolveRoleForEmail(ctx.auth.token.email, ctx)).not.toBe(
          'unauthorized'
        );
      }
      await assertFails(
        rules
          .authenticatedContext('legacy-author', { email: 'old@example.invalid', role: 'admin' })
          .firestore()
          .doc(history.path)
          .get()
      );
      await assertFails(
        rules
          .authenticatedContext('imposter', rulesToken(adminContext.auth.token))
          .firestore()
          .doc(history.path)
          .get()
      );
      const after = await history.get();
      expect(after.data()).toEqual(before.data());
      expect(after.updateTime?.isEqual(before.updateTime!)).toBe(true);
      expect((await auth.getUser(adminContext.auth.uid)).disabled).toBe(false);
      expect((await auth.getUser(sharedContext.auth.uid)).disabled).toBe(false);
    }, 60000);
  }
);
