import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getFirestore, Timestamp, FieldValue } from 'firebase-admin/firestore';
import { getTodayISO } from '@/utils/dateCoreUtils';
import {
  makeRecord,
  makeCanonicalEmptyBed,
} from '@/tests/functions/dailyRecordWriteAuthorityFunctions.test-support';
const require = createRequire(import.meta.url);
const { createAuthHelpers } = require('../../../functions/lib/auth/authHelpersFactory.js');
const {
  createDailyRecordWriteAuthorityFunctions,
} = require('../../../functions/lib/dailyRecordWriteAuthorityFunctions.js');
const {
  createSpecialistMedicalHandoffFunctions,
} = require('../../../functions/lib/specialistMedicalHandoffFunctions.js');
const projectId = 'demo-hhr-e2d-owner';
let rules: RulesTestEnvironment;
const app = initializeApp({ projectId }, 'e2d');
const db = getFirestore(app);
const root = 'hospitals/hanga_roa';
const date = getTodayISO();
const version = new Date(Date.now() - 10000).toISOString();
const uid = 'hhrn_synthetic-b';
const context = {
  auth: {
    uid,
    token: {
      email: uid + '@accounts.hhr.invalid',
      role: 'nurse_hospital',
      hhrAccountVersion: 1,
      auth_time: Math.floor(Date.now() / 1000),
      firebase: { sign_in_provider: 'password' as const },
    },
  },
};
const ref = db.doc(`${root}/dailyRecords/${date}`);
const base = () => ({
  ...makeRecord(),
  date,
  dateTimestamp: Date.now(),
  lastUpdated: version,
  meta: { revision: 2 },
  beds: {
    R1: {
      ...makeRecord().beds.R1,
      documentType: 'RUT',
      admissionDate: date,
      bedMode: 'Cama',
      location: '',
      specialty: '',
      medicalHandoffNote: '',
      medicalHandoffEntries: [],
    },
  },
});
beforeAll(async () => {
  const [host, port] = (process.env.FIRESTORE_EMULATOR_HOST ?? '').split(':');
  if (host !== '127.0.0.1') throw new Error('Local emulator required');
  rules = await initializeTestEnvironment({
    projectId,
    firestore: { host, port: Number(port), rules: readFileSync('firestore.rules', 'utf8') },
  });
});
beforeEach(async () => {
  await rules.clearFirestore();
  await db
    .doc(`hhr_account_access/${uid}`)
    .set({ status: 'active', version: 1, role: 'nurse_hospital' });
  await ref.set(base());
  await db.doc(`${root}/specialtyPolicies/active`).set({
    schemaVersion: 1,
    revision: 1,
    autoEnabled: false,
    memoryEnabled: false,
    aiMode: 'off',
    rules: [],
    memory: [],
  });
});
afterAll(async () => {
  await rules?.cleanup();
  await db.terminate();
  await deleteApp(app);
});
it.each(['specialist', 'specialty', 'clear', 'structural'])(
  'measures A payload dispatched using B authority: %s',
  async kind => {
    if (kind === 'clear')
      await db
        .doc(`${root}/settings/rayenImportPolicy`)
        .set({ schemaVersion: 2, mode: 'preview', clinicalBatchMode: 'enforced' });
    const helpers = createAuthHelpers({ auth: {}, firestore: db });
    const deps = {
      firestore: db,
      Timestamp,
      FieldValue,
      resolveRoleForEmail: async (...args: unknown[]) =>
        kind === 'specialist' ? 'admin' : helpers.resolveRoleForEmail(...args),
    };
    const api = createDailyRecordWriteAuthorityFunctions(deps);
    let result;
    if (kind === 'specialist') {
      const specialist = createSpecialistMedicalHandoffFunctions(deps);
      result = await specialist.updateSpecialistMedicalHandoff.run(
        {
          date,
          patch: { 'beds.R1.medicalHandoffNote': 'SYNTHETIC NOTE AUTHORED BY A' },
          expectedOccupants: [{ bedId: 'R1', target: 'bed', ...base().beds.R1 }],
          mutationId: 'synthetic-A-note',
        },
        context
      );
    } else if (kind === 'structural') {
      result = await api.saveDailyRecordWithClinicalAuthority.run(
        {
          date,
          record: { ...base(), notes: 'SYNTHETIC STRUCTURE BY A' },
          expectedLastUpdated: version,
          syncContract: {
            mutationId: 'synthetic-A-structure',
            baseRevision: 2,
            changedPaths: ['*'],
          },
        },
        context
      );
    } else {
      const patch =
        kind === 'specialty'
          ? { 'beds.R1.specialty': 'Cirugía' }
          : { 'beds.R1': { ...makeCanonicalEmptyBed(), secondarySpecialty: null } };
      process.env.HHR_SPECIALTY_EPISODE_ASSIGNMENT = 'enabled';
      try {
        result = await api.patchDailyRecordWithClinicalAuthority.run(
          {
            date,
            patch,
            expectedLastUpdated: version,
            syncContract: {
              mutationId: 'synthetic-A-' + kind,
              baseRevision: 2,
              changedPaths: Object.keys(patch),
            },
            ...(kind === 'specialty'
              ? {
                  specialtyIntent: {
                    kind: 'manual',
                    bedId: 'R1',
                    target: 'bed',
                    episodeId: 'ep-uno',
                    value: 'Cirugía',
                    expectedDecisionId: null,
                  },
                }
              : {
                  intentionalBedClear: {
                    bedId: 'R1',
                    target: 'bed',
                    confirmedLastUpdated: version,
                    confirmedOccupant: base().beds.R1,
                  },
                }),
          },
          context
        );
      } finally {
        delete process.env.HHR_SPECIALTY_EPISODE_ASSIGNMENT;
      }
    }
    const visible = await rules
      .authenticatedContext(uid, context.auth.token)
      .firestore()
      .doc(ref.path)
      .get();
    process.stdout.write(
      'E2D_AUTHORITY ' +
        kind +
        ' ' +
        JSON.stringify({
          result,
          visible: visible.data(),
          audits: (await ref.collection('specialtyDecisions').get()).docs.map(x => x.data()),
        }) +
        '\n'
    );
    expect(result).toMatchObject({ success: true });
  }
);
