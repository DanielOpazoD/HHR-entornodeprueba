import { createRequire } from 'node:module';
import { createMockUserToken } from '@firebase/util';
import type { Page } from '@playwright/test';
import type { AuthorityCallablePayload } from './dailyRecordAuthorityRoute';

const require = createRequire(import.meta.url);
const requireFunctions = createRequire(new URL('../../functions/package.json', import.meta.url));
const { initializeApp, deleteApp } = requireFunctions(
  'firebase-admin/app'
) as typeof import('firebase-admin/app');
const { getFirestore, Timestamp } = requireFunctions(
  'firebase-admin/firestore'
) as typeof import('firebase-admin/firestore');
const {
  createDailyRecordWriteAuthorityFunctions,
} = require('../../functions/lib/dailyRecordWriteAuthorityFunctions.js');

/** Real server reads and transactions; only releasing the callable response is controlled. */
export const createSpecialtyAuthority = async () => {
  const host = process.env.FIRESTORE_EMULATOR_HOST || '';
  if (!/^(127\.0\.0\.1|localhost):\d+$/.test(host)) {
    throw new Error('Specialty browser proof requires an isolated local Firestore emulator.');
  }
  const projectId = 'demo-hhr-e2e';
  // Keep the shared demo project's existing rules; this fixture never relaxes them.
  const app = initializeApp({ projectId }, 'census-specialty-e2e');
  const db = getFirestore(app);
  const hospital = 'hospitals/hanga_roa';
  const policyRef = db.doc(`${hospital}/specialtyPolicies/active`);
  const previousPolicy = (await policyRef.get()).data();
  const previousFlag = process.env.HHR_SPECIALTY_EPISODE_ASSIGNMENT;
  process.env.HHR_SPECIALTY_EPISODE_ASSIGNMENT = 'enabled';
  const functions = createDailyRecordWriteAuthorityFunctions({
    firestore: db,
    Timestamp,
    resolveRoleForEmail: async () => 'admin',
  });
  const context = {
    auth: { uid: 'synthetic-specialty-editor', token: { email: 'specialty@synthetic.invalid' } },
  };
  const previousRecords = new Map<string, FirebaseFirestore.DocumentData | undefined>();
  const previousCollectionIds = new Map<string, Set<string>>();
  const rememberCollection = async (path: string) => {
    if (!previousCollectionIds.has(path)) {
      previousCollectionIds.set(
        path,
        new Set((await db.collection(path).get()).docs.map(doc => doc.id))
      );
    }
  };
  await rememberCollection(`${hospital}/functionsTelemetry`);
  return {
    authorizeBrowser: async (page: Page) => {
      const token = createMockUserToken(
        {
          sub: context.auth.uid,
          email: context.auth.token.email,
          role: 'admin',
        },
        projectId
      );
      // Emulator-only synthetic identity: real Firestore rules still evaluate the request.
      await page.route(`http://${host}/**`, route =>
        route.continue({
          headers: { ...route.request().headers(), authorization: `Bearer ${token}` },
        })
      );
    },
    seed: async (record: Record<string, unknown>) => {
      const date = String(record.date);
      const ref = db.doc(`${hospital}/dailyRecords/${date}`);
      if (!previousRecords.has(date)) previousRecords.set(date, (await ref.get()).data());
      await Promise.all([
        rememberCollection(`${ref.path}/specialtyDecisions`),
        rememberCollection(`${ref.path}/history`),
      ]);
      await ref.set(record);
      await policyRef.set({
        schemaVersion: 1,
        revision: 1,
        autoEnabled: false,
        memoryEnabled: false,
        aiMode: 'off',
        rules: [],
        memory: [],
      });
    },
    commit: async (payload: AuthorityCallablePayload): Promise<Record<string, unknown>> => {
      const result = await functions.patchDailyRecordWithClinicalAuthority.run(payload, context);
      if (!result.success || !result.recordState?.record) {
        throw new Error('Synthetic specialty authority did not confirm a canonical record.');
      }
      return result.recordState.record;
    },
    read: async (date: string) => (await db.doc(`${hospital}/dailyRecords/${date}`).get()).data(),
    cleanup: async () => {
      if (previousFlag === undefined) delete process.env.HHR_SPECIALTY_EPISODE_ASSIGNMENT;
      else process.env.HHR_SPECIALTY_EPISODE_ASSIGNMENT = previousFlag;
      try {
        for (const [path, previousIds] of previousCollectionIds) {
          const snapshot = await db.collection(path).get();
          await Promise.all(
            snapshot.docs.filter(doc => !previousIds.has(doc.id)).map(doc => doc.ref.delete())
          );
        }
        await Promise.all([
          ...[...previousRecords].map(([date, previous]) => {
            const ref = db.doc(`${hospital}/dailyRecords/${date}`);
            return previous ? ref.set(previous) : ref.delete();
          }),
          previousPolicy ? policyRef.set(previousPolicy) : policyRef.delete(),
        ]);
      } finally {
        await db.terminate();
        await deleteApp(app);
      }
    },
  };
};
