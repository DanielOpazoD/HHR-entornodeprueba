import { expect, test } from '@playwright/test';
import { randomBytes, randomUUID } from 'node:crypto';
import { getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { buildCanonicalE2ERecord } from './fixtures/auth';

// Observational complement to census-startup.measurement.ts. This uses an actual
// Firebase Auth session and a server-confirmed Firestore emulator document.
// Development/Vite timings must not be compared with the production synthetic gate.
const date = '2026-02-20';
const email = 'census-performance@synthetic.invalid';
const password = randomBytes(18).toString('base64url');
const patientName = 'SYNTHETIC REMOTE CENSUS';
const projectId = 'demo-hhr-e2e';
const firebaseConfig = {
  apiKey: 'fake',
  authDomain: 'demo-hhr.firebaseapp.com',
  projectId,
  appId: '1:1234567890:web:abcdef123456',
};

test('measures authenticated census readiness after a real emulator read', async ({
  page,
}, testInfo) => {
  test.setTimeout(90_000);
  if (!process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_AUTH_EMULATOR_HOST) {
    throw new Error('Both FIRESTORE_EMULATOR_HOST and FIREBASE_AUTH_EMULATOR_HOST are required');
  }
  for (const host of [
    process.env.FIRESTORE_EMULATOR_HOST,
    process.env.FIREBASE_AUTH_EMULATOR_HOST,
  ]) {
    if (!/^(127\.0\.0\.1|localhost):\d+$/.test(host)) {
      throw new Error('Performance test requires loopback-only emulator endpoints');
    }
  }

  const app =
    getApps().find(existing => existing.name === 'census-remote-performance') ??
    initializeApp({ projectId }, 'census-remote-performance');
  const auth = getAuth(app);
  const db = getFirestore(app);
  const record = buildCanonicalE2ERecord(date);
  const beds = record.beds as Record<string, Record<string, unknown>>;
  beds.R1 = {
    ...beds.R1,
    patientName,
    pathology: 'SYNTHETIC',
    status: 'Estable',
    age: '40',
  };

  const user = await auth.createUser({
    uid: `hhrn_${randomUUID()}`,
    email,
    password,
    emailVerified: true,
  });
  const accessRef = db.collection('hhr_account_access').doc(user.uid);
  const recordRef = db
    .collection('hospitals')
    .doc('hanga_roa')
    .collection('dailyRecords')
    .doc(date);
  try {
    // Password sessions require managed authority, not a legacy email-role grant.
    await auth.setCustomUserClaims(user.uid, { hhrAccountVersion: 1 });
    await Promise.all([
      accessRef.set({ status: 'active', role: 'nurse_hospital', version: 1 }),
      recordRef.set(record),
    ]);

    let roleLookups = 0;
    await page.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.pathname.endsWith('/checkUserRole')) {
        const requestedHeaders = route.request().headers()['access-control-request-headers'];
        if (route.request().method() === 'OPTIONS') {
          return route.fulfill({
            status: 204,
            headers: {
              'access-control-allow-origin': '*',
              'access-control-allow-headers': requestedHeaders || 'authorization, content-type',
              'access-control-allow-methods': 'POST, OPTIONS',
            },
          });
        }
        if (route.request().method() !== 'POST') {
          throw new Error('Unexpected role lookup method');
        }
        roleLookups += 1;
        return route.fulfill({
          json: { result: { role: 'nurse_hospital' } },
          headers: {
            'access-control-allow-origin': '*',
          },
        });
      }
      if (['127.0.0.1', 'localhost'].includes(url.hostname)) return route.continue();
      return route.abort('blockedbyclient');
    });

    await page.addInitScript(config => {
      localStorage.setItem('hhr_perf_audit', '1');
      localStorage.setItem('hhr_firebase_config', JSON.stringify(config));
    }, firebaseConfig);
    await page.goto('/');
    await page.evaluate(
      async ({ address, secret }) => {
        const modulePath = '/src/services/auth/authCredentialFlow.ts';
        const { signIn } = await import(/* @vite-ignore */ modulePath);
        await signIn(address, secret);
      },
      { address: email, secret: password }
    );
    expect(roleLookups).toBeGreaterThan(0);

    await page.goto(`/censo?date=${date}`);
    const input = page
      .locator('[data-testid="patient-row"][data-bed-id="R1"] input[name="patientName"]')
      .first();
    await expect(input).toHaveValue(patientName, { timeout: 30_000 });
    await expect
      .poll(
        () =>
          page.evaluate(() => {
            const audit = (
              window as Window & {
                __HHR_CENSUS_PERF__?: {
                  visits: Array<{ events: Record<string, number> }>;
                };
              }
            ).__HHR_CENSUS_PERF__;
            return (
              audit?.visits.some(visit => Number.isFinite(visit.events.remote_confirmed)) ?? false
            );
          }),
        { timeout: 30_000 }
      )
      .toBe(true);

    const result = await page.evaluate(() => {
      const audit = (
        window as Window & {
          __HHR_CENSUS_PERF__?: {
            navigationEvents: Record<string, number>;
            visits: Array<{ startedAt: number; events: Record<string, number> }>;
          };
        }
      ).__HHR_CENSUS_PERF__;
      const visit = audit?.visits.find(item => Number.isFinite(item.events.remote_confirmed));
      if (!audit || !visit) throw new Error('No server-confirmed census visit');
      return {
        fixture: 'firebase-auth-and-firestore-emulator',
        build: 'vite-development',
        authMeasured: 'managed-password-session-restore',
        authorization: 'managed-firestore-rules-with-stubbed-role-callable',
        remoteMeasured: true,
        bootstrapToRemoteConfirmedMs:
          visit.events.remote_confirmed - audit.navigationEvents['bootstrap:start'],
        bootstrapToTablePaintMs:
          visit.events.table_paint_opportunity - audit.navigationEvents['bootstrap:start'],
        visitToRemoteConfirmedMs: visit.events.remote_confirmed - visit.startedAt,
      };
    });
    expect(Number.isFinite(result.bootstrapToRemoteConfirmedMs)).toBe(true);
    expect(Number.isFinite(result.bootstrapToTablePaintMs)).toBe(true);
    expect(Number.isFinite(result.visitToRemoteConfirmedMs)).toBe(true);
    expect(result.bootstrapToRemoteConfirmedMs).toBeGreaterThanOrEqual(0);
    expect(result.bootstrapToTablePaintMs).toBeGreaterThanOrEqual(0);
    expect(result.visitToRemoteConfirmedMs).toBeGreaterThanOrEqual(0);
    await testInfo.attach('census-remote-performance.json', {
      body: JSON.stringify(result, null, 2),
      contentType: 'application/json',
    });
  } finally {
    await Promise.all([recordRef.delete(), accessRef.delete(), auth.deleteUser(user.uid)]);
  }
});
