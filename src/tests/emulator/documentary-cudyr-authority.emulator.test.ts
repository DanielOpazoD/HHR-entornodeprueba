import { createRequire } from 'node:module';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { initializeApp, deleteApp, type App } from 'firebase-admin/app';
import { getFirestore, Timestamp, type Firestore } from 'firebase-admin/firestore';
import { DataFactory } from '@/tests/factories/DataFactory';
import { sanitizeForFirestore } from '@/services/storage/firestore/firestoreShared';
import { makeContext } from '@/tests/functions/dailyRecordWriteAuthorityFunctions.test-support';
vi.mock('@/firebaseConfig', () => ({
  firebaseReady: Promise.resolve(),
  firestoreReady: Promise.resolve(),
  auth: null,
  get db() {
    throw new Error('This suite uses only the local emulator.');
  },
  getFunctionsInstance: () => {
    throw new Error('No browser Functions transport.');
  },
}));
const require = createRequire(import.meta.url);
const {
  createRayenClinicalEnrichmentFunctions,
} = require('../../../functions/lib/rayenClinicalEnrichmentFunctions.js');
const local = process.env.RUN_FIRESTORE_EMULATOR_TESTS === '1' ? describe : describe.skip;
const night = '2026-05-13',
  sourceDate = '2026-05-14',
  root = 'hospitals/hanga_roa';
const person = () =>
  DataFactory.createMockPatient('R1', {
    clinicalEpisodeId: 'synthetic-a',
    documentType: 'RUT',
    rut: '11.111.111-1',
    patientName: 'Paciente Sintético',
  });
const score = () => ({
  category: 'C2',
  recordedDate: night,
  source: 'Eloísa · informe mensual',
  documentaryEvidence: {
    reportId: 'synthetic-source',
    sourceRow: 5,
    sourceDate,
    clinicalEpisodeId: 'synthetic-a',
    document: person().rut,
    patientName: person().patientName,
    documentType: 'RUT',
  },
});
local('documentary CUDYR transaction authority', () => {
  let app: App, db: Firestore;
  beforeAll(() => {
    if (!/^(127\.0\.0\.1|localhost):\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST ?? ''))
      throw new Error('A local Firestore emulator is required.');
    app = initializeApp({ projectId: 'demo-hhr-documentary-authority' }, 'documentary-authority');
    db = getFirestore(app);
  });
  afterAll(async () => {
    if (db) await db.terminate();
    if (app) await deleteApp(app);
  });
  const setup = async (scope: 'current' | 'historical') => {
    await db.recursiveDelete(db.doc(root));
    const authorityDate = scope === 'current' ? night : sourceDate;
    const policy = {
      schemaVersion: 2,
      revision: 1,
      mode: 'preview' as const,
      clinicalBatchMode: 'enforced' as const,
    };
    const event = {
      id: 'synthetic-run',
      sourceDate: authorityDate,
      status: 'applied' as const,
      policy,
      startedAt: `${authorityDate}T10:00:00Z`,
      by: 'Operador sintético',
    };
    await db.doc(`${root}/settings/rayenImportPolicy`).set(policy);
    const target = DataFactory.createMockDailyRecord(night, {
      beds: { R1: person() },
      lastUpdated: `${night}T10:00:00Z`,
      rayenSyncHistory: scope === 'current' ? [event] : [],
    });
    await db
      .doc(`${root}/dailyRecords/${night}`)
      .set(
        sanitizeForFirestore({ ...target, meta: { revision: 2 } }) as FirebaseFirestore.DocumentData
      );
    await db.doc(`${root}/dailyRecords/${sourceDate}`).set(
      sanitizeForFirestore(
        DataFactory.createMockDailyRecord(sourceDate, {
          beds: {},
          rayenSyncHistory: scope === 'historical' ? [event] : [],
        })
      ) as FirebaseFirestore.DocumentData
    );
    const api = createRayenClinicalEnrichmentFunctions({
      firestore: db,
      Timestamp,
      resolveRoleForEmail: async () => 'admin',
    });
    const read = async (): Promise<FirebaseFirestore.DocumentData> => {
      const value = (await db.doc(`${root}/dailyRecords/${night}`).get()).data()!;
      return {
        ...value,
        lastUpdated:
          value.lastUpdated instanceof Timestamp
            ? value.lastUpdated.toDate().toISOString()
            : value.lastUpdated,
      };
    };
    const payload = async (
      fieldContractVersion: number,
      fields: Record<string, unknown>,
      mutationId: string
    ) => {
      const current = await read();
      return {
        date: night,
        authorityDate,
        runId: 'synthetic-run',
        mutationId,
        mode: 'enforced',
        fieldContractVersion,
        expectedLastUpdated: current.lastUpdated,
        baseRevision: current.meta.revision,
        clientRuntimeContractVersion: 3,
        patches: [{ bedId: 'R1', clinicalEpisodeId: 'synthetic-a', fields }],
        checkpoints: [],
      };
    };
    const invoke = (body: unknown) =>
      api.applyRayenClinicalEnrichmentBatch.run(body, makeContext());
    const readmission = () =>
      db.doc(`${root}/dailyRecords/${sourceDate}`).update({
        'beds.R2': sanitizeForFirestore({
          ...person(),
          bedId: 'R2',
          clinicalEpisodeId: 'synthetic-readmission',
        }),
      });
    return { read, payload, invoke, readmission };
  };
  it.each(['current', 'historical'] as const)(
    'fills and replays a %s missing result without inventing a time',
    async scope => {
      const { read, payload, invoke } = await setup(scope);
      const body = await payload(3, { evaluationScores: { cudyr: score() } }, 'insert');
      await invoke(body);
      expect((await read()).beds.R1.evaluationScores.cudyr).toEqual(score());
      const saved = await read();
      expect(saved.beds.R1.evaluationScores.cudyr).not.toHaveProperty('recordedAt');
      await invoke(body);
      expect(await read()).toEqual(saved);
    }
  );
  it.each(['current', 'historical'] as const)(
    'rejects a %s attribution invalidated in the other day',
    async scope => {
      const { read, payload, invoke, readmission } = await setup(scope);
      const body = await payload(3, { evaluationScores: { cudyr: score() } }, 'raced');
      const before = await read();
      await readmission();
      await expect(invoke(body)).rejects.toMatchObject({ code: 'failed-precondition' });
      expect(await read()).toEqual(before);
    }
  );
  it('rejects a v2 insertion and a v2 omission after insertion, preserving the accepted result', async () => {
    const { read, payload, invoke } = await setup('current');
    await expect(
      invoke(await payload(2, { evaluationScores: { cudyr: score() } }, 'old-insert'))
    ).rejects.toMatchObject({ code: 'failed-precondition' });
    await invoke(await payload(3, { evaluationScores: { cudyr: score() } }, 'insert'));
    const saved = await read();
    await expect(
      invoke(await payload(2, { evaluationScores: {} }, 'old-remove'))
    ).rejects.toMatchObject({ code: 'failed-precondition' });
    expect(await read()).toEqual(saved);
  });
  it('lets a v2 client update Braden while preserving the accepted CUDYR after a later readmission', async () => {
    const { read, payload, invoke, readmission } = await setup('current');
    await invoke(await payload(3, { evaluationScores: { cudyr: score() } }, 'insert'));
    await readmission();
    const braden = { code: 'BRADEN', name: 'Braden', total: 18 };
    await invoke(await payload(2, { evaluationScores: { cudyr: score(), braden } }, 'adjacent'));
    expect((await read()).beds.R1.evaluationScores).toEqual({ cudyr: score(), braden });
  });
  it('recognizes the same RUT and complete name across formatting differences', async () => {
    const { read, payload, invoke } = await setup('current');
    const equivalent = score();
    equivalent.documentaryEvidence.document = '11111111-1';
    equivalent.documentaryEvidence.patientName = 'Sintético Paciente';
    await invoke(await payload(3, { evaluationScores: { cudyr: equivalent } }, 'equivalent'));
    expect((await read()).beds.R1.evaluationScores.cudyr).toEqual(equivalent);
  });
  it.each(['documentary', 'administrative'])(
    'preserves %s CUDYR through a legacy partial update and rejects empty/array replacement',
    async kind => {
      const { read, payload, invoke } = await setup('current');
      if (kind === 'documentary')
        await invoke(await payload(3, { evaluationScores: { cudyr: score() } }, 'insert'));
      else
        await db.doc(`${root}/dailyRecords/${night}`).update({
          'beds.R1.evaluationScores.cudyr': {
            category: 'C2',
            recordedDate: night,
            source: 'HHR · ajuste administrativo',
          },
        });
      const accepted = (await read()).beds.R1.evaluationScores.cudyr;
      await invoke(
        await payload(1, { evaluationScores: { braden: { total: 18 } } }, 'legacy-partial')
      );
      expect((await read()).beds.R1.evaluationScores).toEqual({
        cudyr: accepted,
        braden: { total: 18 },
      });
      const saved = await read();
      for (const [id, value] of [
        ['empty', {}],
        ['array', []],
      ] as const) {
        await expect(invoke(await payload(1, { evaluationScores: value }, id))).rejects.toThrow();
        expect(await read()).toEqual(saved);
      }
    }
  );
  it.each(['C1', 'C2'])(
    'rejects an ordinary replacement of accepted documentary CUDYR with %s',
    async category => {
      const { read, payload, invoke } = await setup('current');
      await invoke(await payload(3, { evaluationScores: { cudyr: score() } }, 'insert'));
      const saved = await read();
      await expect(
        invoke(
          await payload(
            2,
            {
              evaluationScores: {
                cudyr: {
                  category,
                  recordedDate: night,
                  recordedAt: `${sourceDate}T03:00:00-05:00`,
                  source: 'Eloísa · Gestión de Camas',
                },
              },
            },
            'ordinary-replacement'
          )
        )
      ).rejects.toMatchObject({ code: 'failed-precondition' });
      expect(await read()).toEqual(saved);
    }
  );
  it.each(['passport', 'maternal'])(
    'keeps %s identity markers from a sparse movement',
    async kind => {
      const { read, payload, invoke } = await setup('current');
      await db.doc(`${root}/dailyRecords/${sourceDate}`).update({
        discharges: [
          {
            id: 'synthetic-discharge',
            clinicalEpisodeId: 'synthetic-a',
            patientName: person().patientName,
            rut: person().rut,
            ...(kind === 'passport'
              ? { documentType: 'Pasaporte' }
              : { neonatalMaternalRut: person().rut }),
          },
        ],
      });
      const before = await read();
      await expect(
        invoke(await payload(3, { evaluationScores: { cudyr: score() } }, 'sparse-marker'))
      ).rejects.toMatchObject({ code: 'failed-precondition' });
      expect(await read()).toEqual(before);
    }
  );
});
