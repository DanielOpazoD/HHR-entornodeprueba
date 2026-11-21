import { vi } from 'vitest';
import { deleteApp, initializeApp, type App } from 'firebase-admin/app';
import { getFirestore, Timestamp, type Firestore } from 'firebase-admin/firestore';
import * as authority from '@/services/storage/firestore/dailyRecordAuthorityCallableClient';
import { createDailyRecordWriteAuthorityFunctions } from '@/tests/functions/dailyRecordWriteAuthorityFunctions.test-support';

export interface AuthorityActor {
  uid: string;
  email: string;
  role: string;
}

/**
 * Production writes bed fields and whole days through the authority callables. Against the
 * Firestore emulator (which runs no Functions) this replaces only the callable's network hop: the
 * shipped handler commits with a real admin transaction, as the person `actor()` returns.
 */
export const createEmulatorAuthorityBridge = (projectId: string, actor: () => AuthorityActor) => {
  let app: App | undefined;
  let admin: Firestore | undefined;
  let api: ReturnType<typeof createDailyRecordWriteAuthorityFunctions>;
  const context = () => {
    const { uid, email } = actor();
    return { auth: { uid, token: { email } } };
  };
  const call =
    (handler: 'patchDailyRecordWithClinicalAuthority' | 'saveDailyRecordWithClinicalAuthority') =>
    async (payload: unknown) => {
      try {
        return await api[handler].run(payload, context());
      } catch (error) {
        throw authority.normalizeDailyRecordAuthorityError(error);
      }
    };
  return {
    open: () => {
      app = initializeApp({ projectId }, `${projectId}-authority`);
      admin = getFirestore(app);
      admin.settings({ ignoreUndefinedProperties: true });
      api = createDailyRecordWriteAuthorityFunctions({
        firestore: admin,
        Timestamp,
        resolveRoleForEmail: async () => actor().role,
      });
    },
    /** Seeds the schema-v2 policy (as in production since 2026-11-07) and routes the callables. */
    install: async () => {
      await admin!.doc('hospitals/hanga_roa/settings/rayenImportPolicy').set({
        schemaVersion: 2,
        mode: 'preview',
        revision: 1,
        clinicalBatchMode: 'enforced',
      });
      vi.spyOn(authority, 'patchDailyRecordWithClinicalAuthorityCallable').mockImplementation(
        call('patchDailyRecordWithClinicalAuthority') as never
      );
      vi.spyOn(authority, 'saveDailyRecordWithClinicalAuthorityCallable').mockImplementation(
        call('saveDailyRecordWithClinicalAuthority') as never
      );
    },
    close: async () => {
      await admin?.terminate();
      if (app) await deleteApp(app);
    },
  };
};
