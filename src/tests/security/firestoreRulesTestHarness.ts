import { afterAll, beforeAll, beforeEach, describe } from 'vitest';
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { setLogLevel } from 'firebase/firestore';
import * as fs from 'fs';
import * as path from 'path';
import { resolveFirestoreRulesEmulatorConfig } from './firestoreRulesEmulatorConfig';

export type FirestoreLike = ReturnType<
  ReturnType<RulesTestEnvironment['authenticatedContext']>['firestore']
>;

export type FirestoreRulesHarness = {
  unauth: () => FirestoreLike;
  authed: () => FirestoreLike;
  admin: () => FirestoreLike;
  nurse: () => FirestoreLike;
  doctor: () => FirestoreLike;
  specialist: () => FirestoreLike;
  specialistWithoutClaim: () => FirestoreLike;
  adminWithoutClaim: () => FirestoreLike;
  doctorWithoutClaim: () => FirestoreLike;
  editor: () => FirestoreLike;
  unauthorizedAuthed: () => FirestoreLike;
  firestoreForUser: (uid: string, token: Record<string, unknown>) => FirestoreLike;
  NOW_MS: number;
  THREE_DAYS_MS: number;
  CURRENT_RECORD_DATE: string;
  PREVIOUS_RECORD_DATE: string;
  setupDoc: (db: FirestoreLike, path: string, data: Record<string, unknown>) => Promise<unknown>;
  setupDocBypass: (path: string, data: Record<string, unknown>) => Promise<unknown>;
};

const runRulesTests =
  process.env.RUN_FIRESTORE_RULES_TESTS === '1' ||
  process.env.FIRESTORE_EMULATOR_HOST !== undefined;

const describeRules = runRulesTests ? describe : describe.skip;
const NOW_MS = Date.now();
const THREE_DAYS_MS = 3 * 86400000;
const CURRENT_RECORD_DATE = new Date(NOW_MS).toISOString().slice(0, 10);
const PREVIOUS_RECORD_DATE = new Date(NOW_MS - 86400000).toISOString().slice(0, 10);

async function setupDoc(db: FirestoreLike, path: string, data: Record<string, unknown>) {
  const docRef = db.doc(path);
  await docRef.set(data);
  return docRef;
}

export function registerFirestoreRulesSuite(
  registerGroups: (harness: FirestoreRulesHarness) => void
): void {
  describeRules('Firestore Security Rules', () => {
    let testEnv: RulesTestEnvironment;

    const harness: FirestoreRulesHarness = {
      unauth: () => testEnv.unauthenticatedContext().firestore(),
      authed: () =>
        testEnv
          .authenticatedContext('user_basic', { email: 'user@example.com', role: 'viewer' })
          .firestore(),
      admin: () =>
        testEnv
          .authenticatedContext('user_admin', {
            email: 'daniel.opazo@hospitalhangaroa.cl',
            role: 'admin',
          })
          .firestore(),
      nurse: () =>
        testEnv
          .authenticatedContext('user_nurse', {
            email: 'hospitalizados@hospitalhangaroa.cl',
            role: 'nurse_hospital',
          })
          .firestore(),
      doctor: () =>
        testEnv
          .authenticatedContext('user_doctor', {
            email: 'doctor@example.com',
            role: 'doctor_urgency',
          })
          .firestore(),
      specialist: () =>
        testEnv
          .authenticatedContext('user_specialist', {
            email: 'specialist@example.com',
            role: 'doctor_specialist',
          })
          .firestore(),
      specialistWithoutClaim: () =>
        testEnv
          .authenticatedContext('user_specialist_dynamic', {
            email: 'specialist.dynamic@example.com',
          })
          .firestore(),
      adminWithoutClaim: () =>
        testEnv
          .authenticatedContext('user_admin_dynamic', {
            email: 'admin.dynamic@example.com',
          })
          .firestore(),
      doctorWithoutClaim: () =>
        testEnv
          .authenticatedContext('user_doctor_allowed_only', {
            email: 'doctor.allowed@example.com',
          })
          .firestore(),
      editor: () =>
        testEnv
          .authenticatedContext('user_editor', { email: 'editor@example.com', role: 'editor' })
          .firestore(),
      unauthorizedAuthed: () =>
        testEnv
          .authenticatedContext('user_outsider', { email: 'outsider@example.com' })
          .firestore(),
      firestoreForUser: (uid, token) => testEnv.authenticatedContext(uid, token).firestore(),
      NOW_MS,
      THREE_DAYS_MS,
      CURRENT_RECORD_DATE,
      PREVIOUS_RECORD_DATE,
      setupDoc,
      setupDocBypass: async (docPath, data) =>
        testEnv.withSecurityRulesDisabled(async context => {
          const docRef = context.firestore().doc(docPath);
          await docRef.set(data);
        }),
    };

    beforeAll(async () => {
      setLogLevel('silent');

      const rulesPath = path.resolve(__dirname, '../../../firestore.rules');
      const rules = fs.readFileSync(rulesPath, 'utf8');
      const emulatorConfig = resolveFirestoreRulesEmulatorConfig(
        process.env.FIRESTORE_EMULATOR_HOST
      );

      try {
        testEnv = await initializeTestEnvironment({
          projectId: 'demo-hhr-rules-test',
          firestore: {
            rules,
            host: emulatorConfig.host,
            port: emulatorConfig.port,
          },
        });
      } catch (error) {
        console.error(
          "Failed to init emulator. Is it running? run 'firebase emulators:start --only firestore'"
        );
        throw error;
      }
    });

    afterAll(async () => {
      if (testEnv) {
        await testEnv.cleanup();
      }
    });

    beforeEach(async () => {
      if (testEnv) {
        await testEnv.clearFirestore();
      }

      await setupDoc(harness.admin(), 'config/roles', {
        'user@example.com': 'viewer',
        'daniel.opazo@hospitalhangaroa.cl': 'admin',
        'admin.dynamic@example.com': 'admin',
        'hospitalizados@hospitalhangaroa.cl': 'nurse_hospital',
        'doctor@example.com': 'doctor_urgency',
        'specialist@example.com': 'doctor_specialist',
        'specialist.dynamic@example.com': 'doctor_specialist',
        'editor@example.com': 'editor',
      });
    });

    registerGroups(harness);
  });
}
