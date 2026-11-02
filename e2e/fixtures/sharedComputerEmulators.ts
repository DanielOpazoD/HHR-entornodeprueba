import { expect, type Page } from '@playwright/test';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, Timestamp, FieldValue } from 'firebase-admin/firestore';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { createAuthHelpers } = require('../../functions/lib/auth/authHelpersFactory.js');
const { createAuthFunctions } = require('../../functions/lib/auth/authFunctionsFactory.js');
const { createAccountFunctions } = require('../../functions/lib/accounts/accountFunctions.js');
const {
  createDailyRecordWriteAuthorityFunctions,
} = require('../../functions/lib/dailyRecordWriteAuthorityFunctions.js');
const {
  createRayenClinicalEnrichmentFunctions,
} = require('../../functions/lib/rayenClinicalEnrichmentFunctions.js');

export const first = {
  rut: '222222222',
  name: 'Enfermera Sintética A',
  password: 'Synthetic first phrase 854!',
};
export const second = {
  rut: '333333333',
  name: 'Enfermero Sintético B',
  password: 'Synthetic second phrase 629!',
};
export const privateNote = 'SYNTHETIC PRIVATE HANDOFF A';
export const privateDay = '2026-01-02';

export async function sharedComputerEmulators(page: Page) {
  for (const key of ['FIREBASE_AUTH_EMULATOR_HOST', 'FIRESTORE_EMULATOR_HOST'])
    expect(process.env[key]).toMatch(/^(127\.0\.0\.1|localhost):\d+$/);
  for (const [host, resource] of [
    [process.env.FIREBASE_AUTH_EMULATOR_HOST, 'accounts'],
    [process.env.FIRESTORE_EMULATOR_HOST, 'databases/(default)/documents'],
  ]) {
    const reset = await fetch(
      `http://${host}/emulator/v1/projects/demo-hhr-nursing-accounts/${resource}`,
      { method: 'DELETE' }
    );
    expect(reset.ok).toBe(true);
  }
  const app = initializeApp({ projectId: 'demo-hhr-nursing-accounts' }, 'shared-acceptance');
  const auth = getAuth(app);
  const firestore = getFirestore(app);
  const helpers = createAuthHelpers({ auth, firestore });
  const api = {
    ...createAuthFunctions({ auth, helpers }),
    ...createAccountFunctions({ auth, firestore, helpers, sendMail: async () => {} }),
    ...createDailyRecordWriteAuthorityFunctions({
      firestore,
      Timestamp,
      FieldValue,
      resolveRoleForEmail: helpers.resolveRoleForEmail,
    }),
    ...createRayenClinicalEnrichmentFunctions({
      firestore,
      Timestamp,
      resolveRoleForEmail: helpers.resolveRoleForEmail,
    }),
  };
  // Emulator accepts this synthetic Google assertion; no request leaves loopback.
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const email = 'daniel.opazo@hospitalhangaroa.cl';
  const assertion = `${encode({ alg: 'none', typ: 'JWT' })}.${encode({ sub: 'shared-synthetic-admin', email, email_verified: true, iss: 'https://accounts.google.com', aud: 'synthetic-client', iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 3600 })}.`;
  const response = await fetch(
    `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithIdp?key=synthetic-key`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        postBody: new URLSearchParams({ providerId: 'google.com', id_token: assertion }).toString(),
        requestUri: 'http://localhost',
        returnSecureToken: true,
      }),
    }
  );
  expect(response.ok).toBe(true);
  const { idToken } = await response.json();
  const token = await auth.verifyIdToken(idToken, true);
  await firestore.doc('config/roles').set({ [email]: 'admin' });
  const a = await api.createNursingAccount.run(
    { rut: first.rut, name: first.name, role: 'nurse_hospital', identityVerified: true },
    { auth: { uid: token.uid, token } }
  );
  const b = await api.createNursingAccount.run(
    { rut: second.rut, name: second.name, role: 'nurse_hospital', identityVerified: true },
    { auth: { uid: token.uid, token } }
  );
  const setup = await api.signInWithRut.run({ rut: second.rut, password: '33333333' }, {});
  await api.activateNursingAccount.run(
    {
      rut: second.rut,
      password: second.password,
      recoveryEmail: 'b@example.invalid',
      activationToken: setup.activationToken,
    },
    {}
  );
  const blockedRequests: string[] = [];
  const failures: string[] = [];
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (/^(127\.0\.0\.1|localhost)$/.test(url.hostname)) return route.continue();
    if (!/^[a-z0-9-]+-demo-hhr-nursing-accounts\.cloudfunctions\.net$/.test(url.hostname)) {
      blockedRequests.push(url.origin);
      return route.abort();
    }
    const headers = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
    };
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    const name = url.pathname.slice(1);
    try {
      if (!api[name]?.run || name === 'deliverNursingPasswordRecovery')
        throw new Error('Unsupported test callable');
      const bearer = route
        .request()
        .headers()
        .authorization?.replace(/^Bearer /, '');
      const decoded = bearer ? await auth.verifyIdToken(bearer, true) : null;
      const result = await api[name].run(route.request().postDataJSON()?.data, {
        auth: decoded ? { uid: decoded.uid, token: decoded } : undefined,
        rawRequest: { ip: '127.0.0.1' },
      });
      await route.fulfill({
        headers,
        contentType: 'application/json',
        body: JSON.stringify({ result }),
      });
    } catch (error) {
      const code =
        error && typeof error === 'object' && 'code' in error ? String(error.code) : 'internal';
      failures.push(`${name}:${code}`);
      await route.fulfill({
        status: 403,
        headers,
        contentType: 'application/json',
        body: JSON.stringify({
          error: {
            status: code.replace(/-/g, '_').toUpperCase(),
            message: 'Synthetic callable rejected',
          },
        }),
      });
    }
  });
  return {
    auth,
    firestore,
    a: String(a.uid),
    b: String(b.uid),
    blockedRequests,
    failures,
    close: async () => {
      await firestore.terminate();
      await deleteApp(app);
    },
  };
}

export async function login(page: Page, account: typeof first) {
  await page.getByLabel('Usuario', { exact: true }).fill(account.rut);
  await page.getByLabel('Contraseña', { exact: true }).fill(account.password);
  await page.getByRole('button', { name: 'Ingresar', exact: true }).click();
  await expect(page.getByTestId('authenticated-user-menu-button')).toBeVisible();
  await expect(
    page
      .getByRole('navigation', { name: 'Navegación principal HHR' })
      .getByText(account.name, { exact: true })
  ).toBeVisible();
}
