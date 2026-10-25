import { readFileSync } from 'node:fs';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { deleteApp, initializeApp, type App } from 'firebase-admin/app';
import { FieldValue, getFirestore, Timestamp, type Firestore } from 'firebase-admin/firestore';
import { resolveFirestoreRulesEmulatorConfig } from '@/tests/security/firestoreRulesEmulatorConfig';
import {
  DAY,
  PRIOR_DAY,
  SPLIT_ENV,
  createDailyRecordWriteAuthorityFunctions,
  createRayenClinicalEnrichmentFunctions,
  guardedPatch,
  makeContext,
  makeDay,
  shadowPolicy,
  vitals,
} from '@/tests/functions/clinicalDerivedServer.test-support';
import type { DailyRecord } from '@/types/domain/dailyRecord';

const boundary = vi.hoisted(() => ({
  save: vi.fn(),
  clientDb: null as unknown,
  /** Another writer, between the restore's save and its confirmation. */
  afterSave: null as null | (() => Promise<void>),
}));
vi.mock('@/services/repositories/dailyRecordRepositoryWriteService', () => ({
  saveDetailed: boundary.save,
}));
vi.mock('@/services/storage/indexeddb/indexedDbRecordService', () => ({
  getRecordForDateStrict: async () => null,
}));
// Export helpers only: they load the web Firestore runtime, which the restore does not use.
vi.mock('@/services/admin/dataMaintenanceSupport', () => ({}));
vi.mock('@/services/admin/auditService', () => ({ logAuditEvent: async () => undefined }));
vi.mock('@/services/admin/utils/auditUtils', () => ({
  getCurrentUserEmail: () => 'admin@example.invalid',
}));
// The restore confirms the saved day with the real client reader: an administrator reading the
// emulator under the real rules, never a configured Firebase project.
vi.mock('@/firebaseConfig', () => ({ db: null, auth: null }));
vi.mock('@/services/storage/firestore/firestoreServiceRuntime', () => ({
  defaultFirestoreServiceRuntime: { ready: Promise.resolve(), getDb: () => boundary.clientDb },
}));

import { importRecordsFromBackup } from '@/services/admin/dataMaintenanceService';
import { restoreClinicalDerivedBackupDay } from '@/services/exporters/clinicalDerivedBackupRestore';

type Data = FirebaseFirestore.DocumentData;

const enabled =
  process.env.RUN_FIRESTORE_EMULATOR_TESTS === '1' || process.env.FIRESTORE_EMULATOR_HOST;

const checkpoint = (watermark: string) => ({
  version: 3,
  fingerprintVersion: 1,
  sources: { vitals: { watermark } },
});
const HISTORY = [vitals(DAY, 72), vitals(PRIOR_DAY, 70)];

// Delete -> restore from a JSON backup -> next split write, on a real Firestore: the restore is
// the administrator importer, its save the authority callable. Synthetic data, local emulator only.
(enabled ? describe : describe.skip)('restore of a split day on Firestore', () => {
  let app: App;
  let db: Firestore;
  let rules: RulesTestEnvironment;
  const hospital = 'hospitals/hanga_roa';
  const dayDoc = () => db.doc(`${hospital}/dailyRecords/${DAY}`);
  const episodeRef = (episodeId: string) => dayDoc().collection('clinicalDerived').doc(episodeId);
  const read = async () => (await dayDoc().get()).data() as Data;
  const iso = (value: unknown) =>
    value instanceof Timestamp ? value.toDate().toISOString() : String(value);
  const api = (role: string) => {
    const dependencies = {
      firestore: db,
      Timestamp,
      FieldValue,
      resolveRoleForEmail: vi.fn().mockResolvedValue(role),
    };
    return {
      ...createDailyRecordWriteAuthorityFunctions(dependencies),
      ...createRayenClinicalEnrichmentFunctions(dependencies),
    };
  };

  beforeAll(async () => {
    if (!/^(127\.0\.0\.1|localhost):\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST ?? '')) {
      throw new Error('Local emulator required');
    }
    const projectId = 'demo-hhr-clinical-derived-restore';
    app = initializeApp({ projectId }, 'derived-restore');
    db = getFirestore(app);
    await db.doc(hospital).get();
    rules = await initializeTestEnvironment({
      projectId,
      firestore: {
        ...resolveFirestoreRulesEmulatorConfig(process.env.FIRESTORE_EMULATOR_HOST),
        rules: readFileSync('firestore.rules', 'utf8'),
      },
    });
    boundary.clientDb = rules
      .authenticatedContext('synthetic-admin', { role: 'admin' })
      .firestore();
    // Compiling the rules can take more than a minute on a loaded machine.
  }, 300_000);
  afterAll(async () => {
    if (rules) await rules.cleanup();
    if (db) await db.terminate();
    if (app) await deleteApp(app);
  });
  let restorerRole = 'admin';
  beforeEach(async () => {
    restorerRole = 'admin';
    boundary.afterSave = null;
    await db.recursiveDelete(db.doc(hospital));
    vi.useFakeTimers({ toFake: ['Date'], now: new Date(`${DAY}T16:00:00.000Z`) });
    vi.stubEnv(SPLIT_ENV, PRIOR_DAY);
    // The repository save as the authority callable runs it for an administrator's restore.
    boundary.save.mockImplementation(
      async (record: DailyRecord, _expected: unknown, options: { writeOrigin?: string }) => {
        await api(restorerRole).saveDailyRecordWithClinicalAuthority.run(
          {
            date: record.date,
            // As the callable client sends it: JSON, so undefined fields are left out.
            record: JSON.parse(JSON.stringify(record)),
            mode: 'shadow',
            origin: options.writeOrigin,
            clientRuntimeContractVersion: 3,
          },
          makeContext()
        );
        const saved = await read();
        await boundary.afterSave?.();
        return {
          outcome: 'clean',
          savedLocally: true,
          savedRemotely: true,
          confirmedRecord: { ...saved, lastUpdated: iso(saved.lastUpdated) },
        };
      }
    );
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  /** A split day with R2's history in its document, then its JSON backup, then deleted. */
  const splitBackUpAndDelete = async () => {
    await db.doc(`${hospital}/settings/rayenImportPolicy`).set(shadowPolicy);
    const day = makeDay();
    const beds = day.beds as Record<string, Data>;
    beds.R1.clinicalSyncCheckpoint = checkpoint('m-1');
    beds.R2.clinicalSyncCheckpoint = checkpoint('p-1');
    await dayDoc().set(day);
    await api('nurse_hospital').patchDailyRecordWithClinicalAuthority.run(
      guardedPatch({
        'beds.R2.vitalSignsHistory': HISTORY,
        'beds.R2.clinicalSyncCheckpoint': checkpoint('p-2'),
      }),
      makeContext()
    );

    // The JSON backup of the split day: the day without R2's moved fields, plus its section.
    const splitDay = await read();
    const leftover = (await episodeRef('ep_pasaporte_2').get()).data() as Data;
    expect(splitDay.beds.R2).not.toHaveProperty('vitalSignsHistory');
    const backup = JSON.parse(
      JSON.stringify({
        version: '1.0',
        exportDate: `${DAY}T15:00:00.000Z`,
        year: 2026,
        month: 11,
        recordCount: 1,
        records: [{ ...splitDay, lastUpdated: iso(splitDay.lastUpdated) }],
        clinicalDerived: {
          [DAY]: {
            status: 'exported',
            layoutGeneration: splitDay.clinicalDerivedLayout.generation,
            docs: [{ ...leftover, updatedAt: iso(leftover.updatedAt) }],
          },
        },
      })
    );

    await dayDoc().delete();
    return { backup, leftover };
  };

  it('brings the history back and keeps the deleted generation document', async () => {
    const { backup, leftover } = await splitBackUpAndDelete();

    const result = await importRecordsFromBackup(backup);
    // The synthetic server-shaped day needs the client's default repairs; nothing is partial.
    expect(result).toEqual({ success: 1, failed: 0, repaired: 1, outcome: 'repaired' });

    const restored = await read();
    expect(restored.clinicalDerivedLayout.generation).not.toBe(leftover.layoutGeneration);
    expect(restored.beds.R2.vitalSignsHistory).toEqual(HISTORY);

    // The first split write after the restore: a checkpoint-only batch of an enforced run.
    await db
      .doc(`${hospital}/settings/rayenImportPolicy`)
      .set({ ...shadowPolicy, revision: 5, clinicalBatchMode: 'enforced' });
    await dayDoc().update({
      rayenSyncHistory: FieldValue.arrayUnion({
        id: 'run-synthetic-2',
        status: 'applied',
        sourceDate: DAY,
        policy: { mode: 'preview', revision: 5, clinicalBatchMode: 'enforced' },
      }),
    });
    const batch = {
      date: DAY,
      authorityDate: DAY,
      runId: 'run-synthetic-2',
      mutationId: 'batch-after-restore',
      expectedLastUpdated: iso((await read()).lastUpdated),
      baseRevision: restored.meta.revision,
      fieldContractVersion: 2,
      mode: 'enforced',
      patches: [],
      checkpoints: [
        { bedId: 'R2', clinicalEpisodeId: 'ep_pasaporte_2', checkpoint: checkpoint('p-3') },
      ],
      clientRuntimeContractVersion: 3,
    };
    // Sent twice, as a retry after a lost response would.
    await api('nurse_hospital').applyRayenClinicalEnrichmentBatch.run(batch, makeContext());
    await api('nurse_hospital').applyRayenClinicalEnrichmentBatch.run(batch, makeContext());

    expect((await read()).beds.R2).not.toHaveProperty('vitalSignsHistory');
    expect((await episodeRef('ep_pasaporte_2').get()).data()).toMatchObject({
      layoutGeneration: restored.clinicalDerivedLayout.generation,
      vitalSignsHistory: HISTORY,
      clinicalSyncCheckpoint: checkpoint('p-3'),
    });
    const copies = await dayDoc()
      .collection('history')
      .where('snapshotReason', '==', 'clinical_derived_displaced')
      .get();
    expect(copies.docs.map(copy => copy.data().clinicalDerivedPrevious)).toEqual([
      { ep_pasaporte_2: { document: leftover } },
    ]);
  });

  it('reports the restore partial when the server recreates the day without the history', async () => {
    const { backup } = await splitBackUpAndDelete();
    // Under the Rayen fence only an administrator's restore keeps the clinical fields.
    restorerRole = 'nurse_hospital';

    const result = await importRecordsFromBackup(backup);

    expect((await read()).beds.R2).not.toHaveProperty('vitalSignsHistory');
    expect(result).toMatchObject({
      success: 1,
      outcome: 'partial',
      clinicalDerivedIncompleteDates: [DAY],
    });
  });

  it('confirms a restore over the stored split day through its episode document', async () => {
    const { backup, leftover } = await splitBackUpAndDelete();
    await dayDoc().set(backup.records[0]);

    const result = await importRecordsFromBackup(backup);

    expect(result).toEqual({ success: 1, failed: 0, repaired: 1, outcome: 'repaired' });
    // The server kept the stored day: the history is still in the document, untouched.
    expect((await read()).beds.R2).not.toHaveProperty('vitalSignsHistory');
    expect((await episodeRef('ep_pasaporte_2').get()).data()).toEqual(leftover);
  });

  it('reports the restore partial when the stored split day lost its episode document', async () => {
    const { backup } = await splitBackUpAndDelete();
    await dayDoc().set(backup.records[0]);
    await episodeRef('ep_pasaporte_2').delete();

    const result = await importRecordsFromBackup(backup);

    expect((await read()).beds.R2).not.toHaveProperty('vitalSignsHistory');
    expect((await episodeRef('ep_pasaporte_2').get()).exists).toBe(false);
    expect(result).toMatchObject({ outcome: 'partial', clinicalDerivedIncompleteDates: [DAY] });
  });

  it('reports the restore partial when a stored day of another generation keeps other values', async () => {
    const { backup } = await splitBackUpAndDelete();
    const stored = structuredClone(backup.records[0]);
    stored.clinicalDerivedLayout.generation = 'gen_synthetic_other';
    stored.beds.R2.vitalSignsHistory = [vitals(PRIOR_DAY, 199)];
    stored.beds.R2.clinicalSyncCheckpoint = checkpoint('unrelated');
    await dayDoc().set(stored);

    const result = await importRecordsFromBackup(backup);

    expect((await read()).beds.R2.vitalSignsHistory).toEqual([vitals(PRIOR_DAY, 199)]);
    expect(result).toMatchObject({ outcome: 'partial', clinicalDerivedIncompleteDates: [DAY] });
  });

  it('reports the restore partial when another writer recreates the day after its save', async () => {
    const { backup } = await splitBackUpAndDelete();
    const generation = 'gen_synthetic_recreated_after_save';
    boundary.afterSave = async () => {
      // The save confirmed the restored day; the day the server holds now has a new generation
      // whose episode document carries other values.
      const recreated = await read();
      recreated.clinicalDerivedLayout = { version: 1, generation };
      delete recreated.beds.R2.vitalSignsHistory;
      delete recreated.beds.R2.clinicalSyncCheckpoint;
      await dayDoc().set(recreated);
      await episodeRef('ep_pasaporte_2').set({
        schemaVersion: 1,
        date: DAY,
        clinicalEpisodeId: 'ep_pasaporte_2',
        layoutGeneration: generation,
        target: 'bed',
        bedId: 'R2',
        dayRevision: recreated.meta.revision,
        lastMutationId: 'synthetic-recreate',
        vitalSignsHistory: [vitals(PRIOR_DAY, 199)],
        clinicalSyncCheckpoint: checkpoint('unrelated'),
      });
    };

    const result = await importRecordsFromBackup(backup);

    expect((await episodeRef('ep_pasaporte_2').get()).data()).toMatchObject({
      layoutGeneration: generation,
      vitalSignsHistory: [vitals(PRIOR_DAY, 199)],
    });
    expect(result).toEqual({
      success: 1,
      failed: 0,
      repaired: 1,
      outcome: 'partial',
      clinicalDerivedIncompleteDates: [DAY],
    });
  });

  it.each([true, false])(
    'brings the history back for an administrator with the Rayen fence %s',
    async fence => {
      const { backup, leftover } = await splitBackUpAndDelete();
      if (!fence) await db.doc(`${hospital}/settings/rayenImportPolicy`).delete();

      const result = await importRecordsFromBackup(backup);

      expect(result).toEqual({ success: 1, failed: 0, repaired: 1, outcome: 'repaired' });
      const restored = await read();
      expect(restored.beds.R2.vitalSignsHistory).toEqual(HISTORY);
      expect(restored.beds.R2.clinicalSyncCheckpoint).toEqual(checkpoint('p-2'));
      expect((await episodeRef('ep_pasaporte_2').get()).data()).toEqual(leftover);
    }
  );

  it.each([true, false])(
    'rejects an outdated client restoring the split day with the Rayen fence %s',
    async fence => {
      const { backup } = await splitBackUpAndDelete();
      if (!fence) await db.doc(`${hospital}/settings/rayenImportPolicy`).delete();
      const restore = restoreClinicalDerivedBackupDay(backup.records[0], backup.clinicalDerived);
      if (restore.kind !== 'embedded') throw new Error('The synthetic backup must restore.');

      await expect(
        api('admin').saveDailyRecordWithClinicalAuthority.run(
          {
            date: DAY,
            record: JSON.parse(JSON.stringify(restore.record)),
            mode: 'shadow',
            origin: 'backup_restore',
            clientRuntimeContractVersion: 2,
          },
          makeContext()
        )
      ).rejects.toMatchObject({
        code: 'failed-precondition',
        message: expect.stringContaining('clinical_derived_client_outdated'),
      });
      expect((await dayDoc().get()).exists).toBe(false);
    }
  );

  it('a guarded patch after the restore keeps the history and one displaced copy on retry', async () => {
    const { backup, leftover } = await splitBackUpAndDelete();
    await importRecordsFromBackup(backup);
    await dayDoc().update({ rayenSyncHistory: makeDay().rayenSyncHistory });
    const payload = guardedPatch(
      { 'beds.R2.clinicalSyncCheckpoint': checkpoint('p-guarded') },
      {
        expectedLastUpdated: iso((await read()).lastUpdated),
        syncContract: {
          mutationId: 'patch-after-restore',
          changedPaths: ['beds.R2.clinicalSyncCheckpoint'],
        },
      }
    );

    await api('nurse_hospital').patchDailyRecordWithClinicalAuthority.run(payload, makeContext());
    await api('nurse_hospital').patchDailyRecordWithClinicalAuthority.run(payload, makeContext());

    expect((await episodeRef('ep_pasaporte_2').get()).data()).toMatchObject({
      vitalSignsHistory: HISTORY,
      clinicalSyncCheckpoint: checkpoint('p-guarded'),
    });
    const copies = await dayDoc()
      .collection('history')
      .where('snapshotReason', '==', 'clinical_derived_displaced')
      .get();
    expect(copies.docs.map(copy => copy.data().clinicalDerivedPrevious)).toEqual([
      { ep_pasaporte_2: { document: leftover } },
    ]);
  });
});
