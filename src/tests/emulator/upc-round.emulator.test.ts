import { afterAll, beforeAll, expect, it } from 'vitest';
import { deleteApp, initializeApp, type App } from 'firebase-admin/app';
import { getFirestore, Timestamp, type Firestore } from 'firebase-admin/firestore';
import { getTodayISO } from '@/utils/dateCoreUtils';
import { DataFactory } from '@/tests/factories/DataFactory';
import { buildUpcCriteriaEvaluation } from '@/features/census/domain/upcCriteriaEvaluation';
import { bedManagementReducer } from '@/hooks/useBedManagementReducer';
import { createDailyRecordWriteAuthorityFunctions } from '@/tests/functions/dailyRecordWriteAuthorityFunctions.test-support';

let app: App;
let db: Firestore;
beforeAll(() => {
  if (!/^(127\.0\.0\.1|localhost):\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST ?? ''))
    throw new Error('Local Firestore emulator required');
  app = initializeApp({ projectId: 'demo-hhr-upc-round' }, 'upc-round');
  db = getFirestore(app);
  db.settings({ ignoreUndefinedProperties: true });
});
afterAll(async () => {
  if (db) await db.terminate();
  if (app) await deleteApp(app);
});

// @flake-safe: the synthetic nurse writes within the real hospital window for the current census.
it.each([false, true])(
  'writes the complete round or preserves every row when stale=%s',
  async stale => {
    const date = getTodayISO();
    const bed = (id: string, episode: string) =>
      DataFactory.createMockPatient(id, {
        patientName: 'Paciente de prueba',
        clinicalEpisodeId: episode,
      });
    const occupied = DataFactory.createMockDailyRecord(date, {
      lastUpdated: `${date}T09:00:00.000Z`,
      beds: {
        R1: { ...bed('R1', 'ep_adult'), clinicalCrib: bed('R1', 'ep_crib') },
        R2: bed('R2', 'ep_other'),
        NEO1: bed('NEO1', 'ep_neo'),
        H1C1: bed('H1C1', 'ep_untouched'),
      },
    });
    const actor = { uid: 'nurse-test', displayName: 'Profesional de prueba' };
    const subjects = [
      ['R1', 'ep_adult', false],
      ['R1', 'ep_crib', true],
      ['R2', 'ep_other', false],
      ['NEO1', 'ep_neo', false],
    ] as const;
    const evaluations = subjects.map(([bedId, episode, isCrib]) => {
      return {
        bedId,
        isCrib,
        episodeIdentity: episode,
        record: buildUpcCriteriaEvaluation({
          actor,
          date,
          bedId,
          evaluationId: episode,
          evaluatedAt: `${date}T10:00:00.000Z`,
          uciCriteria: episode === 'ep_adult' ? ['uci_vmi'] : [],
          utiCriteria: episode === 'ep_crib' ? ['uti_mon_respiratoria'] : [],
        }),
      };
    });
    const patch = bedManagementReducer(occupied, { type: 'CONFIRM_UPC_ROUND', evaluations });
    expect(patch).not.toBeNull();
    const ref = db.doc(`hospitals/hanga_roa/dailyRecords/${date}`);
    await ref.set({ ...occupied, meta: { revision: 1 } });
    if (stale) {
      await ref.update({ 'beds.R2.clinicalEpisodeId': 'ep_replacement', 'meta.revision': 2 });
    }
    await db
      .doc('hospitals/hanga_roa/settings/rayenImportPolicy')
      .set({ schemaVersion: 2, clinicalBatchMode: 'enforced' });
    const before = (await ref.get()).data()!;
    const authority = createDailyRecordWriteAuthorityFunctions({
      firestore: db,
      Timestamp,
      resolveRoleForEmail: async () => 'nurse_hospital',
    });
    const confirmation = authority.patchDailyRecordWithClinicalAuthority.run(
      {
        date,
        patch,
        syncContract: {
          mutationId: `upc-round-${stale}`,
          baseRevision: 1,
          changedPaths: Object.keys(patch!),
        },
      },
      { auth: { uid: actor.uid, token: { email: 'nurse@example.invalid' } } }
    );
    if (stale) {
      await expect(confirmation).rejects.toMatchObject({ code: 'aborted' });
      expect((await ref.get()).data()).toEqual(before);
      return;
    }
    await confirmation;
    const saved = (await ref.get()).data()!;
    expect(saved.meta.revision).toBe(2);
    for (const { bedId, isCrib, record } of evaluations) {
      const subject = isCrib ? saved.beds[bedId].clinicalCrib : saved.beds[bedId];
      expect(subject.upcChecklist).toMatchObject({
        evaluationId: record.evaluationId,
        evaluatedBy: actor,
        classification: record.classification,
        history: [{ evaluationId: record.evaluationId, evaluatedBy: actor }],
      });
    }
    expect(saved.bedTypeOverrides.R1).toBe('UCI');
    expect(saved.beds.H1C1).toEqual(before.beds.H1C1);
  }
);
