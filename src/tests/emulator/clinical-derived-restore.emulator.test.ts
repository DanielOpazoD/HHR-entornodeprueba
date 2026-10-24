import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { deleteApp, initializeApp, type App } from 'firebase-admin/app';
import { FieldValue, getFirestore, Timestamp, type Firestore } from 'firebase-admin/firestore';
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

const boundary = vi.hoisted(() => ({ save: vi.fn() }));
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

import { importRecordsFromBackup } from '@/services/admin/dataMaintenanceService';

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
    app = initializeApp({ projectId: 'demo-hhr-clinical-derived-restore' }, 'derived-restore');
    db = getFirestore(app);
    await db.doc(hospital).get();
  }, 60_000);
  afterAll(async () => {
    if (db) await db.terminate();
    if (app) await deleteApp(app);
  });
  beforeEach(async () => {
    await db.recursiveDelete(db.doc(hospital));
    vi.useFakeTimers({ toFake: ['Date'], now: new Date(`${DAY}T16:00:00.000Z`) });
    vi.stubEnv(SPLIT_ENV, PRIOR_DAY);
    // The repository save as the authority callable runs it for an administrator's restore.
    boundary.save.mockImplementation(
      async (record: DailyRecord, _expected: unknown, options: { writeOrigin?: string }) => {
        await api('admin').saveDailyRecordWithClinicalAuthority.run(
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

  it('brings the history back and keeps the deleted generation document', async () => {
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
    const result = await importRecordsFromBackup(backup);
    expect(result).toMatchObject({ success: 1, failed: 0 });

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
    await api('nurse_hospital').applyRayenClinicalEnrichmentBatch.run(
      {
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
      },
      makeContext()
    );

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
});
