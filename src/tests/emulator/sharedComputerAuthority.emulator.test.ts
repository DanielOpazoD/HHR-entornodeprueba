import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { deleteApp, initializeApp, type App } from 'firebase-admin/app';
import { FieldValue, getFirestore, Timestamp, type Firestore } from 'firebase-admin/firestore';
import { getTodayISO } from '@/utils/dateCoreUtils';
import { getPreviousDay } from '@/utils/clinicalDayUtils';

const require = createRequire(import.meta.url);
const { createAuthHelpers } = require('../../../functions/lib/auth/authHelpersFactory.js');
const {
  createDailyRecordWriteAuthorityFunctions,
} = require('../../../functions/lib/dailyRecordWriteAuthorityFunctions.js');
const {
  createRayenClinicalEnrichmentFunctions,
} = require('../../../functions/lib/rayenClinicalEnrichmentFunctions.js');
const { createCudyrHistoryFunctions } = require('../../../functions/lib/cudyrHistoryFunctions.js');
const {
  beginInitialPassword,
} = require('../../../functions/lib/accounts/accountInitialPassword.js');

// Actual callable handlers and transactions, synthetic claims; no HTTP Functions/Auth deployment.
const emulator = process.env.RUN_FIRESTORE_EMULATOR_TESTS === '1' ? describe : describe.skip;
const projectId = 'demo-hhr-shared-computer';
const root = 'hospitals/hanga_roa';
const a = 'hhrn_synthetic-a';
const b = 'hhrn_synthetic-b';
const policy = { schemaVersion: 2, mode: 'preview', clinicalBatchMode: 'enforced', revision: 1 };
const contextFor = (uid: string, ageSeconds = 0) => ({
  auth: {
    uid,
    token: {
      email: `${uid}@accounts.hhr.invalid`,
      name: `SYNTHETIC ${uid}`,
      role: 'nurse_hospital',
      hhrAccountVersion: 1,
      auth_time: Math.floor(Date.now() / 1000) - ageSeconds,
      firebase: { sign_in_provider: 'password' as const },
    },
  },
});

emulator(
  'same-device managed nurse authority with real Firestore rules and server handlers',
  () => {
    let app: App;
    let db: Firestore;
    let rules: RulesTestEnvironment;
    let date: string;
    let initialVersion: string;
    const base = () => ({
      date,
      dateTimestamp: Date.now(),
      lastUpdated: initialVersion,
      beds: {
        R1: {
          bedId: 'R1',
          patientName: 'SYNTHETIC PATIENT',
          documentType: 'Pasaporte',
          rut: 'SYNTHETIC-PASSPORT',
          admissionDate: date,
          admissionTime: '08:00',
          clinicalEpisodeId: 'synthetic-episode',
          isBlocked: false,
        },
      },
      discharges: [],
      transfers: [],
      cma: [],
      meta: { revision: 1 },
    });
    const api = () => {
      const helpers = createAuthHelpers({ auth: {}, firestore: db });
      return {
        helpers,
        ...createDailyRecordWriteAuthorityFunctions({
          firestore: db,
          Timestamp,
          FieldValue,
          resolveRoleForEmail: helpers.resolveRoleForEmail,
        }),
        ...createRayenClinicalEnrichmentFunctions({
          firestore: db,
          Timestamp,
          resolveRoleForEmail: helpers.resolveRoleForEmail,
        }),
        ...createCudyrHistoryFunctions({ firestore: db, ...helpers }),
      };
    };
    const run = (uid: string) => ({
      id: `synthetic-run-${uid}`,
      sourceDate: date,
      startedAt: new Date().toISOString(),
      status: 'applied',
      by: `SYNTHETIC ${uid}`,
      policy,
    });
    const clinicalPayload = (uid: string) => ({
      date,
      authorityDate: date,
      runId: run(uid).id,
      mutationId: `synthetic-clinical-${uid}`,
      fieldContractVersion: 2,
      expectedLastUpdated: initialVersion,
      baseRevision: 1,
      clientRuntimeContractVersion: 3,
      mode: 'enforced',
      patches: [
        {
          bedId: 'R1',
          clinicalEpisodeId: 'synthetic-episode',
          fields: { evaluationScores: { braden: { total: 17 } } },
        },
      ],
    });
    const archivePayload = (uid: string) => ({
      schemaVersion: 1,
      authorityDate: date,
      runId: run(uid).id,
      evaluations: [
        {
          clinicalEpisodeId: 'synthetic-episode',
          sourceEvaluationId: `synthetic-evaluation-${uid}`,
          source: 'gestion_camas',
          recordedAt: `${date}T14:00:00-05:00`,
          category: 'C2',
          author: 'SYNTHETIC ELOISA EVALUATOR',
        },
      ],
    });
    const nurse = (uid: string, ageSeconds = 0) =>
      rules.authenticatedContext(uid, contextFor(uid, ageSeconds).auth.token).firestore();

    beforeAll(async () => {
      const host = process.env.FIRESTORE_EMULATOR_HOST ?? '';
      if (!/^(127\.0\.0\.1|localhost):\d+$/.test(host))
        throw new Error('Only a loopback Firestore emulator is permitted');
      const [hostname, port] = host.split(':');
      app = initializeApp({ projectId }, 'shared-computer-rehearsal');
      db = getFirestore(app);
      rules = await initializeTestEnvironment({
        projectId,
        firestore: {
          host: hostname,
          port: Number(port),
          rules: readFileSync('firestore.rules', 'utf8'),
        },
      });
    });
    beforeEach(async () => {
      await rules.clearFirestore();
      date = getTodayISO();
      initialVersion = new Date(Date.now() - 10_000).toISOString();
      for (const uid of [a, b]) {
        await db.doc(`hhr_account_access/${uid}`).set({
          status: 'active',
          version: 1,
          role: 'nurse_hospital',
        });
      }
      await db.doc(`${root}/settings/rayenImportPolicy`).set(policy);
      await db.doc(`${root}/dailyRecords/${date}`).set(base());
    });
    afterAll(async () => {
      await rules?.cleanup();
      await db?.terminate();
      if (app) await deleteApp(app);
    });

    it.each([a, b])(
      '%s confirms structure, enriches and archives under its own active nurse account',
      async uid => {
        const functions = api();
        const context = contextFor(uid);
        expect(await functions.helpers.resolveRoleForEmail(context.auth.token.email, context)).toBe(
          'nurse_hospital'
        );
        await assertSucceeds(nurse(uid).doc(`${root}/settings/rayenImportPolicy`).get());
        await expect(
          functions.saveDailyRecordWithClinicalAuthority.run(
            {
              date,
              expectedLastUpdated: base().lastUpdated,
              mode: 'enforced',
              origin: 'rayen_import',
              clientRuntimeContractVersion: 3,
              record: { ...base(), rayenSyncHistory: [run(uid)] },
              syncContract: {
                mutationId: `synthetic-structure-${uid}`,
                changedPaths: ['rayenSyncHistory'],
              },
            },
            context
          )
        ).resolves.toMatchObject({ success: true });
        const structural = (await db.doc(`${root}/dailyRecords/${date}`).get()).data();
        const structuralVersion =
          structural?.lastUpdated instanceof Timestamp
            ? structural.lastUpdated.toDate().toISOString()
            : structural?.lastUpdated;
        await expect(
          functions.applyRayenClinicalEnrichmentBatch.run(
            {
              ...clinicalPayload(uid),
              expectedLastUpdated: structuralVersion,
              baseRevision: structural?.meta.revision,
            },
            context
          )
        ).resolves.toMatchObject({ success: true });
        await expect(
          functions.archiveCudyrHistory.run(archivePayload(uid), context)
        ).resolves.toMatchObject({ persisted: true });
        const stored = await assertSucceeds(nurse(uid).doc(`${root}/dailyRecords/${date}`).get());
        expect(stored.data()?.beds.R1.evaluationScores.braden.total).toBe(17);
        expect(stored.data()?.rayenSyncHistory[0].by).toBe(run(uid).by);
        const history = await db.collection(`${root}/cudyrHistory`).get();
        expect(history.docs.map(doc => doc.data())).toEqual([
          expect.objectContaining({
            firstCapturedBy: context.auth.token.email,
            evaluation: expect.objectContaining({ author: 'SYNTHETIC ELOISA EVALUATOR' }),
          }),
        ]);
        // Archive collections are server-only: the UI reads them through the clinical callable.
        await assertFails(nurse(uid).doc(history.docs[0].ref.path).get());
        await expect(
          functions.readCudyrHistory.run({ from: date, to: date, limit: 10 }, context)
        ).resolves.toMatchObject({
          observations: [expect.objectContaining({ firstCapturedBy: context.auth.token.email })],
        });
        await assertFails(
          nurse(uid).doc(history.docs[0].ref.path).update({ firstCapturedBy: 'impostor' })
        );
        await assertFails(
          nurse(uid)
            .doc(`${root}/dailyRecords/${date}`)
            .update({ 'beds.R1.patientName': 'FORBIDDEN DIRECT WRITE' })
        );
        await assertFails(
          nurse(uid).doc(`${root}/settings/rayenImportPolicy`).update({ revision: 2 })
        );
      }
    );

    it.each([a, b])('lets %s synchronize previous-day CUDYR and replay it', async uid => {
      const functions = api();
      const previous = getPreviousDay(date);
      await db.doc(`${root}/dailyRecords/${date}`).set({ ...base(), rayenSyncHistory: [run(uid)] });
      await db.doc(`${root}/dailyRecords/${previous}`).set({ ...base(), date: previous });
      const payload = {
        ...clinicalPayload(uid),
        date: previous,
        patches: [
          {
            bedId: 'R1',
            clinicalEpisodeId: 'synthetic-episode',
            fields: { evaluationScores: { cudyr: { category: 'C2', source: 'Eloísa' } } },
          },
        ],
      };
      await expect(
        functions.applyRayenClinicalEnrichmentBatch.run(payload, contextFor(uid))
      ).resolves.toMatchObject({ success: true, authorityStatus: 'ok' });
      const confirmed = (await db.doc(`${root}/dailyRecords/${previous}`).get()).data();
      expect(confirmed?.beds.R1.evaluationScores.cudyr.category).toBe('C2');
      await expect(
        functions.applyRayenClinicalEnrichmentBatch.run(payload, contextFor(uid))
      ).resolves.toMatchObject({ success: true, authorityStatus: 'idempotent' });
      expect((await db.doc(`${root}/dailyRecords/${previous}`).get()).data()).toEqual(confirmed);
    });

    it.each(['doctor_urgency', 'doctor_specialist', 'editor', 'viewer'])(
      'does not grant historical CUDYR synchronization to %s',
      async role => {
        const functions = api();
        const previous = getPreviousDay(date);
        await db.doc(`hhr_account_access/${b}`).update({ role });
        await db.doc(`${root}/dailyRecords/${date}`).set({ ...base(), rayenSyncHistory: [run(b)] });
        await db.doc(`${root}/dailyRecords/${previous}`).set({ ...base(), date: previous });
        const context = contextFor(b);
        const payload = {
          ...clinicalPayload(b),
          date: previous,
          patches: [
            {
              bedId: 'R1',
              clinicalEpisodeId: 'synthetic-episode',
              fields: { evaluationScores: { cudyr: { category: 'C2', source: 'Eloísa' } } },
            },
          ],
        };
        await expect(
          functions.applyRayenClinicalEnrichmentBatch.run(payload, {
            auth: { ...context.auth, token: { ...context.auth.token, role } },
          })
        ).rejects.toMatchObject({ code: 'permission-denied' });
        expect(
          (await db.doc(`${root}/dailyRecords/${previous}`).get()).data()?.beds.R1.evaluationScores
        ).toBeUndefined();
      }
    );

    it('does not let a nurse change other historical clinical fields', async () => {
      const functions = api();
      const previous = getPreviousDay(date);
      await db.doc(`${root}/dailyRecords/${date}`).set({ ...base(), rayenSyncHistory: [run(a)] });
      await db.doc(`${root}/dailyRecords/${previous}`).set({ ...base(), date: previous });
      await expect(
        functions.applyRayenClinicalEnrichmentBatch.run(
          {
            ...clinicalPayload(a),
            date: previous,
          },
          contextFor(a)
        )
      ).rejects.toMatchObject({ code: 'invalid-argument' });
      expect(
        (await db.doc(`${root}/dailyRecords/${previous}`).get()).data()?.beds.R1.evaluationScores
      ).toBeUndefined();
    });

    it.each(['pending', 'expired'] as const)(
      'denies %s B clinical reads, structure, clinical batch and archive despite a nurse claim',
      async state => {
        if (state === 'pending') {
          await db
            .doc(`hhr_account_access/${b}`)
            .update({ status: 'pending', initialPasswordEnabled: true });
          await expect(
            beginInitialPassword({
              firestore: db,
              uid: b,
              rut: '11111111-1',
              password: '11111111',
              now: () => Date.now(),
            })
          ).resolves.toEqual({ requiresSetup: true, activationToken: expect.any(String) });
          expect((await db.doc(`hhr_account_access/${b}`).get()).data()?.status).toBe('pending');
        }
        const age = state === 'expired' ? 43201 : 0;
        const context = contextFor(b, age);
        const functions = api();
        expect(await functions.helpers.resolveRoleForEmail(context.auth.token.email, context)).toBe(
          'unauthorized'
        );
        await assertFails(nurse(b, age).doc(`${root}/dailyRecords/${date}`).get());
        await assertFails(
          nurse(b, age).doc(`${root}/dailyRecords/${date}`).update({ notes: 'DENIED' })
        );
        await expect(
          functions.saveDailyRecordWithClinicalAuthority.run({ date, record: base() }, context)
        ).rejects.toMatchObject({ code: 'permission-denied' });
        await expect(
          functions.applyRayenClinicalEnrichmentBatch.run(clinicalPayload(b), context)
        ).rejects.toMatchObject({ code: 'permission-denied' });
        await expect(
          functions.archiveCudyrHistory.run(archivePayload(b), context)
        ).rejects.toMatchObject({ code: 'permission-denied' });
        await expect(
          functions.readCudyrHistory.run({ from: date, to: date, limit: 10 }, context)
        ).rejects.toMatchObject({ code: 'permission-denied' });
        expect((await db.doc(`${root}/dailyRecords/${date}`).get()).data()?.meta.revision).toBe(1);
        expect((await db.collection(`${root}/cudyrHistory`).get()).empty).toBe(true);
      }
    );
  }
);
