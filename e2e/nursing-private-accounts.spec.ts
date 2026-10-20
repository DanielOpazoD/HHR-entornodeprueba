import { test, expect } from '@playwright/test';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getAuth, type DecodedIdToken } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { createAuthHelpers } = require('../functions/lib/auth/authHelpersFactory.js');
const { createAuthFunctions } = require('../functions/lib/auth/authFunctionsFactory.js');
const { createAccountFunctions } = require('../functions/lib/accounts/accountFunctions.js');

test('admin issues a private activation; nurse sets and changes their own password without losing Google', async ({
  page,
}) => {
  for (const key of ['FIREBASE_AUTH_EMULATOR_HOST', 'FIRESTORE_EMULATOR_HOST']) {
    expect(process.env[key]).toMatch(/^(127\.0\.0\.1|localhost):\d+$/);
  }
  const app = initializeApp({ projectId: 'demo-hhr-nursing-accounts' }, 'nursing-browser');
  const auth = getAuth(app);
  const firestore = getFirestore(app);
  try {
    await page.clock.install();
    let adminContext: { uid: string; token: DecodedIdToken } | undefined;
    let createdNurseUid = '';
    const helpers = createAuthHelpers({ auth, firestore });
    const api = {
      ...createAuthFunctions({ auth, helpers }),
      ...createAccountFunctions({ auth, firestore, helpers }),
    };
    // Real production handlers and real emulator identity verification. This is an in-process
    // callable transport, not a deployed Functions/CORS or real Google OAuth claim.
    await page.route(/https:\/\/[^/]+\.cloudfunctions\.net\/[^/?]+/, async route => {
      const headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
      };
      if (route.request().method() === 'OPTIONS') {
        await route.fulfill({ status: 204, headers });
        return;
      }
      const name = new URL(route.request().url()).pathname.slice(1);
      try {
        if (!api[name]?.run) throw new Error('Not available in this account scenario');
        const bearer = route
          .request()
          .headers()
          .authorization?.replace(/^Bearer /, '');
        const decoded = bearer ? await auth.verifyIdToken(bearer, true) : null;
        if (decoded?.email === 'daniel.opazo@hospitalhangaroa.cl') {
          adminContext = { uid: decoded.uid, token: decoded };
        }
        const result = await api[name].run(route.request().postDataJSON()?.data, {
          auth: decoded ? { uid: decoded.uid, token: decoded } : undefined,
          rawRequest: { ip: '127.0.0.1' },
        });
        if (name === 'createNursingAccount') createdNurseUid = result.uid;
        await route.fulfill({
          headers,
          contentType: 'application/json',
          body: JSON.stringify({ result }),
        });
      } catch {
        await route.fulfill({
          status: 403,
          headers,
          contentType: 'application/json',
          body: JSON.stringify({
            error: { status: 'PERMISSION_DENIED', message: 'No se pudo validar el acceso.' },
          }),
        });
      }
    });
    const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
    const googleToken = `${encode({ alg: 'none', typ: 'JWT' })}.${encode({ sub: 'synthetic-admin', email: 'daniel.opazo@hospitalhangaroa.cl', email_verified: true, iss: 'https://accounts.google.com', aud: 'synthetic-client', iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 3600 })}.`;
    await page.goto('/');
    await expect(page.getByTestId('login-google-button')).toBeVisible();
    await page.evaluate(async idToken => {
      const path = '/src/services/auth/authGoogleFlow.ts';
      const { signInWithGoogle } = await import(path);
      await signInWithGoogle({ googleCredential: { idToken, isCurrent: () => true } });
    }, googleToken);
    await expect(page.getByTestId('authenticated-user-menu-button')).toBeVisible();
    await page.goto('/role-management');
    await expect(page.getByRole('heading', { name: 'Usuarios de enfermería' })).toBeVisible();
    await page
      .getByLabel('Nombre verificado', { exact: true })
      .fill('Enfermera Navegador Sintética');
    await page.getByLabel('RUT con DV', { exact: true }).fill('22.222.222-2');
    await page
      .getByLabel('Referencia verificada del funcionario')
      .fill('Padrón sintético de prueba');
    await page.getByRole('checkbox', { name: /Verifiqué identidad/ }).check();
    await page.getByRole('button', { name: 'Crear cuenta y activación privada' }).click();
    const code = await page
      .getByLabel('Código privado de activación', { exact: true })
      .inputValue();
    expect(code).toHaveLength(80);
    await page.getByTestId('authenticated-user-menu-button').click();
    await page.getByRole('button', { name: 'Cerrar sesión', exact: true }).click();
    await expect(page.getByTestId('login-google-button')).toBeVisible();
    await page.getByRole('button', { name: 'Ingresar con RUT / activar cuenta' }).click();
    await page.getByRole('button', { name: 'Tengo un código de activación' }).click();
    await page.getByLabel('RUT con dígito verificador').fill('22.222.222-2');
    await page.getByLabel('Código privado de activación').fill(code);
    await page.getByLabel('Elige tu clave personal').fill('private browser phrase 854!');
    await page.getByLabel('Repite tu nueva clave').fill('private browser phrase 854!');
    await page.getByRole('button', { name: 'Establecer clave e ingresar' }).click();
    const menu = page.getByTestId('authenticated-user-menu-button');
    await expect(menu).toBeVisible();
    await expect(menu).toHaveAttribute('title', 'Enfermera Navegador Sintética');
    await menu.click();
    await page.getByRole('button', { name: 'Cambiar mi clave', exact: true }).click();
    await page.getByLabel('Clave actual').fill('private browser phrase 854!');
    await page.getByLabel('Nueva clave', { exact: true }).fill('changed browser phrase 629!');
    await page.getByLabel('Repite la nueva clave').fill('changed browser phrase 629!');
    await page.getByRole('button', { name: 'Cambiar clave', exact: true }).click();
    await expect(page.getByText(/Clave cambiada/)).toBeVisible();
    await page.getByRole('button', { name: 'Cerrar', exact: true }).click();
    await menu.click();
    await page.getByRole('button', { name: 'Cerrar sesión', exact: true }).click();
    await expect(page.getByTestId('login-google-button')).toBeVisible();
    await page.getByRole('button', { name: 'Ingresar con RUT / activar cuenta' }).click();
    await page.getByLabel('RUT con dígito verificador').fill('22.222.222-2');
    await page.getByLabel('Clave', { exact: true }).fill('changed browser phrase 629!');
    await page.getByRole('button', { name: 'Ingresar con RUT', exact: true }).click();
    await expect(menu).toBeVisible();
    expect(
      await page.evaluate(() =>
        JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } })
      )
    ).not.toContain('browser phrase');

    // A live revocation must use canonical logout: hide the clinical session,
    // clear private caches, and preserve pending work under its original owner.
    expect(createdNurseUid).toMatch(/^hhrn_/);
    const nurse = await auth.getUser(createdNurseUid);
    expect(nurse.displayName).toBe('Enfermera Navegador Sintética');
    const pendingId = await page.evaluate(async uid => {
      const storagePath = '/src/services/storage/indexeddb/indexedDbCore.ts';
      const cachePath = '/src/config/queryClient.ts';
      const { hospitalDB } = await import(storagePath);
      const { queryClient } = await import(cachePath);
      const authPath = '/src/services/firebase-runtime/authRuntime.ts';
      const { defaultAuthRuntime } = await import(authPath);
      if (defaultAuthRuntime.getCurrentUser()?.uid !== uid)
        throw new Error('Unexpected synthetic session owner');
      queryClient.setQueryData(['synthetic-private-session'], { owner: uid });
      return hospitalDB.syncQueue.add({
        type: 'UPDATE_DAILY_RECORD',
        payload: { date: '2026-01-01', synthetic: 'preserved pending work' },
        timestamp: Date.now(),
        retryCount: 0,
        status: 'FAILED',
        opId: 'synthetic-revocation-test',
        ownerKey: `user:${uid}`,
        syncContract: {
          changedPaths: ['nursesDayShift'],
          expectedVersion: 'synthetic-original-version',
        },
      });
    }, nurse.uid);
    expect(adminContext).toBeDefined();
    await api.manageNursingAccount.run(
      { uid: nurse.uid, action: 'revoke' },
      { auth: adminContext }
    );
    await page.clock.fastForward(61000);
    await expect(page.getByTestId('login-google-button')).toBeVisible();
    const afterRevocation = await page.evaluate(async id => {
      const storagePath = '/src/services/storage/indexeddb/indexedDbCore.ts';
      const cachePath = '/src/config/queryClient.ts';
      const { hospitalDB } = await import(storagePath);
      const { queryClient } = await import(cachePath);
      return {
        task: await hospitalDB.syncQueue.get(id),
        privateCache: queryClient.getQueryData(['synthetic-private-session']) ?? null,
      };
    }, pendingId);
    expect(afterRevocation.privateCache).toBeNull();
    expect(afterRevocation.task).toMatchObject({
      ownerKey: `user:${nurse.uid}`,
      status: 'FAILED',
      payload: { date: '2026-01-01', synthetic: 'preserved pending work' },
      syncContract: {
        changedPaths: ['nursesDayShift'],
        expectedVersion: 'synthetic-original-version',
      },
    });
  } finally {
    await firestore.terminate();
    await deleteApp(app);
  }
});
