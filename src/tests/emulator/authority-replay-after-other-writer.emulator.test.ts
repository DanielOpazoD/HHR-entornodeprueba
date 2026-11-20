import { createRequire } from 'node:module';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { deleteApp, initializeApp, type App } from 'firebase-admin/app';
import { FieldValue, getFirestore, Timestamp, type Firestore } from 'firebase-admin/firestore';
import { getTodayISO } from '@/utils/dateCoreUtils';

// The shipped patch and whole-day handlers with their real admin transactions; synthetic claims and
// data. A's answer is lost after the server committed, another computer saves, and A sends the
// very same request again (the callable's retry or the queue's replay).
const require = createRequire(import.meta.url);
const {
  createDailyRecordWriteAuthorityFunctions,
} = require('../../../functions/lib/dailyRecordWriteAuthorityFunctions.js');

const emulator = process.env.RUN_FIRESTORE_EMULATOR_TESTS === '1' ? describe : describe.skip;
const projectId = 'demo-hhr-authority-replay-other-writer';
const root = 'hospitals/hanga_roa';
const context = (uid: string) => ({ auth: { uid, token: { email: `${uid}@example.invalid` } } });
const patient = (bedId: string, rut: string) => ({
  bedId,
  patientName: `PACIENTE SINTETICO ${bedId}`,
  rut,
  admissionDate: '2026-11-01',
  admissionTime: '08:00',
  clinicalEpisodeId: `synthetic-episode-${bedId}`,
  pathology: '',
  isBlocked: false,
});

emulator('a replay of a committed edit after another computer saved', () => {
  let app: App;
  let db: Firestore;
  type Handler = { run: (data: unknown, ctx: unknown) => Promise<unknown> };
  let api: {
    patchDailyRecordWithClinicalAuthority: Handler;
    saveDailyRecordWithClinicalAuthority: Handler;
  };
  let date: string;
  const dayRef = () => db.doc(`${root}/dailyRecords/${date}`);
  type StoredDay = {
    lastUpdated: unknown;
    meta: { revision: number };
    beds: Record<string, Record<string, unknown>>;
  } & Record<string, unknown>;
  const stored = async () => (await dayRef().get()).data() as StoredDay;
  const versionOf = (day: StoredDay) =>
    day.lastUpdated instanceof Timestamp ? day.lastUpdated.toDate().toISOString() : day.lastUpdated;
  /** The request a computer sends for `patch` over the day as it reads it now. */
  const request = async (uid: string, mutationId: string, patch: Record<string, unknown>) => {
    const day = await stored();
    return {
      date,
      patch,
      expectedLastUpdated: versionOf(day),
      mode: 'enforced',
      origin: 'direct_partial_update',
      historyPolicy: 'skip',
      syncContract: {
        mutationId,
        clientId: uid,
        expectedVersion: versionOf(day),
        baseRevision: day.meta.revision,
        changedPaths: Object.keys(patch),
      },
    };
  };
  const patchOn = (uid: string, data: unknown) =>
    api.patchDailyRecordWithClinicalAuthority.run(data, context(uid));

  beforeAll(async () => {
    const host = process.env.FIRESTORE_EMULATOR_HOST ?? '';
    if (!/^(127\.0\.0\.1|localhost):\d+$/.test(host))
      throw new Error('Only a loopback Firestore emulator is permitted');
    app = initializeApp({ projectId }, 'authority-replay-other-writer');
    db = getFirestore(app);
    db.settings({ ignoreUndefinedProperties: true });
    api = createDailyRecordWriteAuthorityFunctions({
      firestore: db,
      Timestamp,
      FieldValue,
      resolveRoleForEmail: async (email: string) =>
        email.startsWith('admin') ? 'admin' : 'nurse_hospital',
    });
  });
  beforeEach(async () => {
    date = getTodayISO();
    for (const doc of await db.collection(`${root}/dailyRecords`).listDocuments())
      await db.recursiveDelete(doc);
    // What production runs since 2026-11-07: the schema-v2 policy with enforced clinical batches.
    await db.doc(`${root}/settings/rayenImportPolicy`).set({
      schemaVersion: 2,
      mode: 'preview',
      revision: 7,
      clinicalBatchMode: 'enforced',
    });
    await dayRef().set({
      date,
      dateTimestamp: Date.now(),
      lastUpdated: new Date(Date.now() - 60_000).toISOString(),
      beds: { R1: patient('R1', '12.345.678-5'), R2: patient('R2', '11.111.111-1') },
      discharges: [],
      transfers: [],
      cma: [],
      nurses: [],
      activeExtraBeds: [],
      meta: { revision: 1 },
    });
  });
  afterAll(async () => {
    await db?.terminate();
    if (app) await deleteApp(app);
  });

  it('confirms the patch without a second write when the other computer saved another bed', async () => {
    const sent = await request('synthetic-A', 'synthetic-A-1', { 'beds.R1.pathology': 'NEUMONIA' });
    await expect(patchOn('synthetic-A', sent)).resolves.toMatchObject({ revision: 2 });
    await expect(
      patchOn(
        'synthetic-B',
        await request('synthetic-B', 'synthetic-B-1', { 'beds.R2.pathology': 'ITU' })
      )
    ).resolves.toMatchObject({ revision: 3 });
    const afterB = await stored();

    const replay = await patchOn('synthetic-A', sent);

    expect(replay).toMatchObject({
      success: true,
      authorityStatus: 'idempotent',
      revision: 3,
      mutationId: 'synthetic-A-1',
      recordState: {
        record: { beds: { R1: { pathology: 'NEUMONIA' }, R2: { pathology: 'ITU' } } },
      },
    });
    expect(await stored()).toEqual(afterB);
  });

  it('confirms the whole-day save the same way', async () => {
    const day = await stored();
    const { meta: _meta, ...rest } = day;
    const record = {
      ...rest,
      beds: { ...day.beds, R1: { ...day.beds.R1, pathology: 'NEUMONIA' } },
    };
    const sent = {
      date,
      record,
      expectedLastUpdated: versionOf(day),
      mode: 'enforced',
      origin: 'outbox',
      syncContract: {
        mutationId: 'synthetic-A-save',
        clientId: 'synthetic-A',
        expectedVersion: versionOf(day),
        baseRevision: 1,
        changedPaths: ['beds.R1.pathology'],
      },
    };
    await expect(
      api.saveDailyRecordWithClinicalAuthority.run(sent, context('synthetic-A'))
    ).resolves.toMatchObject({ revision: 2 });
    await patchOn(
      'synthetic-B',
      await request('synthetic-B', 'synthetic-B-1', { 'beds.R2.pathology': 'ITU' })
    );
    const afterB = await stored();

    await expect(
      api.saveDailyRecordWithClinicalAuthority.run(sent, context('synthetic-A'))
    ).resolves.toMatchObject({ authorityStatus: 'idempotent', revision: 3 });
    expect(await stored()).toEqual(afterB);
  });

  it('does not take the edit as applied when the other computer then wrote the same field', async () => {
    const sent = await request('synthetic-A', 'synthetic-A-1', { 'beds.R1.pathology': 'NEUMONIA' });
    await patchOn('synthetic-A', sent);
    await patchOn(
      'synthetic-B',
      await request('synthetic-B', 'synthetic-B-1', { 'beds.R1.pathology': 'NEUMONIA GRAVE' })
    );
    const afterB = await stored();

    await expect(patchOn('synthetic-A', sent)).rejects.toMatchObject({ code: 'aborted' });
    expect(await stored()).toEqual(afterB);
    expect(afterB.beds.R1.pathology).toBe('NEUMONIA GRAVE');
  });

  // The independent review's probes (W20-C3-REVIEW): every case where the edit may no longer be
  // the one stored decides as main does; only another bed changed by anyone is recognized.
  afterEach(() => vi.unstubAllEnvs());
  const diagnosis = 'beds.R1.pathology';
  const write = async (uid: string, id: string, patch: Record<string, unknown>) =>
    patchOn(uid, await request(uid, id, patch));
  const begin = async () => {
    const sent = await request('A', 'review-first', { [diagnosis]: 'UNO' });
    await expect(patchOn('A', sent)).resolves.toMatchObject({ revision: 2 });
    return sent;
  };
  const statusOf = async (promise: Promise<unknown>) => {
    try {
      return ((await promise) as { authorityStatus: string }).authorityStatus;
    } catch (error) {
      return (error as { code: string }).code;
    }
  };
  /** A's replay of `sent` answers `expected` and leaves the stored day as it was. */
  const checkReplay = async (sent: unknown, expected: string) => {
    const before = await stored();
    expect(await statusOf(patchOn('A', sent))).toBe(expected);
    expect(await stored()).toEqual(before);
  };

  it('decides as main after another computer wrote the same text back (ABA)', async () => {
    const sent = await begin();
    await write('B', 'b1', { [diagnosis]: 'DOS' });
    await write('B', 'b2', { [diagnosis]: 'UNO' });
    await checkReplay(sent, 'aborted');
  });

  it('decides as main after another computer wrote another field of the same bed', async () => {
    const sent = await begin();
    await write('B', 'b1', { 'beds.R1.status': 'Grave' });
    await checkReplay(sent, 'aborted');
  });

  it.each(['episode', 'patient'])(
    'decides as main after the bed got the next %s with the same text',
    async kind => {
      const sent = await begin();
      const { meta, ...day } = await stored();
      const next = {
        ...day,
        beds: {
          ...day.beds,
          R1: {
            ...day.beds.R1,
            clinicalEpisodeId: 'review-next-episode',
            admissionDate: date,
            admissionTime: '12:00',
            ...(kind === 'patient'
              ? { rut: '10.000.013-K', patientName: 'SIGUIENTE SINTETICO' }
              : {}),
          },
        },
      };
      await expect(
        api.saveDailyRecordWithClinicalAuthority.run(
          {
            date,
            record: next,
            expectedLastUpdated: versionOf({ ...day, meta }),
            mode: 'enforced',
            syncContract: {
              mutationId: 'admit',
              clientId: 'admin-B',
              baseRevision: meta.revision,
              changedPaths: ['beds.R1'],
            },
          },
          context('admin-B')
        )
      ).resolves.toMatchObject({ revision: 3 });
      expect((await stored()).beds.R1).toMatchObject({
        clinicalEpisodeId: 'review-next-episode',
        pathology: 'UNO',
      });
      await checkReplay(sent, 'aborted');
    }
  );

  it.each([
    ['another account', 'patch', 'B', 'B'],
    ['another account', 'full', 'B', 'B'],
    ['the same account on another computer', 'patch', 'A', 'A-other-computer'],
    ['the same account on another computer', 'full', 'A', 'A-other-computer'],
  ])(
    'saves a fresh edit that repeats the identifier from %s (%s)',
    async (_label, mode, uid, clientId) => {
      await begin();
      // Another writer in between, so the day's last write is not that identifier any more.
      await write('C', 'intervening', { 'beds.R2.pathology': 'TRES' });
      const fresh = await request(uid, 'review-first', { [diagnosis]: 'DOS' });
      fresh.syncContract.clientId = clientId;
      const { meta: _meta, ...day } = await stored();
      const answer =
        mode === 'patch'
          ? patchOn(uid, fresh)
          : api.saveDailyRecordWithClinicalAuthority.run(
              {
                ...fresh,
                patch: undefined,
                record: { ...day, beds: { ...day.beds, R1: { ...day.beds.R1, pathology: 'DOS' } } },
              },
              context(uid)
            );
      expect(await statusOf(answer)).toBe('ok');
      expect((await stored()).beds.R1.pathology).toBe('DOS');
    }
  );

  it.each(['patch', 'full'] as const)(
    'saves a correction with the same account and identifier after a computer that sent none (%s)',
    async mode => {
      // W20-C3 recheck: the first computer omits `clientId`, the second sends one and another
      // text; only the same value can be the same edit.
      const first = await request('A', 'shared', { [diagnosis]: 'UNO' });
      delete (first.syncContract as { clientId?: string }).clientId;
      await expect(patchOn('A', first)).resolves.toMatchObject({ revision: 2 });
      await write('B', 'another', { 'beds.R2.pathology': 'TRES' });
      const fresh = await request('A', 'shared', { [diagnosis]: 'DOS' });
      fresh.syncContract.clientId = 'segundo-equipo';
      const { meta: _meta, ...day } = await stored();
      const answer =
        mode === 'patch'
          ? patchOn('A', fresh)
          : api.saveDailyRecordWithClinicalAuthority.run(
              {
                ...fresh,
                patch: undefined,
                record: { ...day, beds: { ...day.beds, R1: { ...day.beds.R1, pathology: 'DOS' } } },
              },
              context('A')
            );
      expect(await statusOf(answer)).toBe('ok');
      expect(await stored()).toMatchObject({
        meta: { revision: 4 },
        beds: { R1: { pathology: 'DOS' } },
      });
    }
  );

  it('decides as main after a restore, and after a tracked write that follows it', async () => {
    const sent = await begin();
    const restored = await stored();
    await dayRef()
      .collection('conflictSnapshots')
      .doc('restore_synthetic')
      .set({
        record: restored,
        snapshotType: 'daily_restore_day',
        episodeBackupIds: [],
        expireAt: Timestamp.fromMillis(Date.now() + 600_000),
      });
    const {
      createDailyRecordRestoreFunctions,
    } = require('../../../functions/lib/dailyRecordRestoreFunctions');
    await createDailyRecordRestoreFunctions({
      firestore: db,
      Timestamp,
      resolveRoleForEmail: async () => 'admin',
    }).restoreDailyRecord.run(
      {
        date,
        backupId: 'restore_synthetic',
        confirmationDate: date,
        expectedLastUpdated: versionOf(restored),
      },
      context('admin')
    );
    await checkReplay(sent, 'aborted');
    await write('C', 'intervening', { 'beds.R2.pathology': 'TRES' });
    expect((await stored()).meta).toMatchObject({ fieldWrites: { incompleteThrough: 3 } });
    await checkReplay(sent, 'aborted');
  });

  it('decides as main after a direct client write the map does not record', async () => {
    const sent = await begin();
    await write('B', 'intervening', { 'beds.R2.status': 'Grave' });
    await dayRef().update({
      handoffNovedadesNightShift: 'NOCHE',
      lastUpdated: '2026-11-20T22:00:00Z',
    });
    await checkReplay(sent, 'aborted');
  });

  it('decides as main when the map no longer names the edit', async () => {
    const sent = await begin();
    const many = Object.fromEntries(
      Array.from({ length: 301 }, (_, i) => [`key${i}`, `value${i}`])
    );
    const { meta, ...day } = await stored();
    await expect(
      api.saveDailyRecordWithClinicalAuthority.run(
        {
          date,
          expectedLastUpdated: versionOf({ ...day, meta }),
          record: { ...day, ...many },
          mode: 'enforced',
          syncContract: {
            mutationId: 'large',
            clientId: 'B',
            baseRevision: 2,
            changedPaths: ['*'],
          },
        },
        context('admin-B')
      )
    ).resolves.toMatchObject({ revision: 3 });
    expect((await stored()).meta).not.toHaveProperty(['fieldWrites', 'fields', diagnosis]);
    await checkReplay(sent, 'aborted');
  });

  it.each([2, 3])('recognizes an ordinary replay from client runtime v%s', async version => {
    const sent = {
      ...(await request('A', 'legitimate', { [diagnosis]: 'UNO' })),
      clientRuntimeContractVersion: version,
    };
    await expect(patchOn('A', sent)).resolves.toMatchObject({ success: true, revision: 2 });
    await write('B', 'other', { 'beds.R2.pathology': 'OTRO' });
    await checkReplay(sent, 'idempotent');
  });

  it.each([
    ['without a contract', 'aborted'],
    ['without a computer identifier', 'idempotent'],
  ])('answers an older caller %s', async (variant, expected) => {
    const sent: { syncContract?: { clientId?: string } } = await request('A', 'legacy', {
      [diagnosis]: 'UNO',
    });
    if (variant === 'without a contract') delete sent.syncContract;
    else delete sent.syncContract?.clientId;
    await expect(patchOn('A', sent)).resolves.toMatchObject({ success: true, revision: 2 });
    await write('B', 'other', { 'beds.R2.pathology': 'OTRO' });
    await checkReplay(sent, expected);
  });

  it.each([
    ['CUDYR', 'R2', 'idempotent'],
    ['Rayen', 'R2', 'idempotent'],
    ['specialty', 'R2', 'idempotent'],
    ['CUDYR', 'R1', 'aborted'],
    ['Rayen', 'R1', 'aborted'],
    ['specialty', 'R1', 'aborted'],
  ])('after the real %s writer in %s the replay answers %s', async (writer, bed, expected) => {
    await dayRef().update({
      [`beds.${bed}.cie10Code`]: 'J18.9',
      [`beds.${bed}.specialty`]: '',
      [`beds.${bed}.evaluationScores`]: {
        cudyr: { category: 'C1', recordedDate: date, source: 'synthetic' },
      },
      rayenSyncHistory: [
        {
          id: 'synthetic-run',
          sourceDate: date,
          startedAt: new Date().toISOString(),
          status: 'applied',
          by: 'Persona sintética',
          policy: { schemaVersion: 2, mode: 'preview', clinicalBatchMode: 'enforced', revision: 7 },
        },
      ],
    });
    const sent = await begin();
    await write('C', 'intervening', { 'beds.R2.pathology': 'TRES' });
    const day = await stored();
    const deps = { firestore: db, Timestamp, FieldValue, resolveRoleForEmail: async () => 'admin' };
    if (writer === 'CUDYR') {
      const {
        createAdminCudyrResultFunctions,
      } = require('../../../functions/lib/adminCudyrResultFunctions');
      await createAdminCudyrResultFunctions(deps).setAdminCudyrResult.run(
        {
          date,
          expectedLastUpdated: versionOf(day),
          clinicalEpisodeId: `synthetic-episode-${bed}`,
          bedId: bed,
          category: 'B1',
        },
        context('admin')
      );
      expect((await stored()).beds[bed]).toMatchObject({
        evaluationScores: { cudyr: { category: 'B1' } },
      });
    } else if (writer === 'Rayen') {
      const {
        createRayenClinicalEnrichmentFunctions,
      } = require('../../../functions/lib/rayenClinicalEnrichmentFunctions');
      await createRayenClinicalEnrichmentFunctions(deps).applyRayenClinicalEnrichmentBatch.run(
        {
          date,
          authorityDate: date,
          runId: 'synthetic-run',
          mutationId: 'review-batch',
          fieldContractVersion: 2,
          expectedLastUpdated: versionOf(day),
          baseRevision: 3,
          clientRuntimeContractVersion: 3,
          mode: 'enforced',
          patches: [
            {
              bedId: bed,
              clinicalEpisodeId: `synthetic-episode-${bed}`,
              fields: { evaluationScores: { braden: { total: 17 } } },
            },
          ],
        },
        context('admin')
      );
      expect((await stored()).beds[bed]).toMatchObject({
        evaluationScores: { braden: { total: 17 } },
      });
    } else {
      vi.stubEnv('HHR_SPECIALTY_EPISODE_ASSIGNMENT', 'enabled');
      const {
        createSpecialtyPolicyFunctions,
      } = require('../../../functions/lib/specialtyPolicyFunctions');
      const policy = {
        schemaVersion: 1,
        revision: 1,
        autoEnabled: false,
        memoryEnabled: false,
        aiMode: 'off',
        rules: [],
        memory: [],
      };
      await db.doc(`${root}/specialtyPolicies/active`).set(policy);
      await createSpecialtyPolicyFunctions(deps).configureSpecialtyPolicy.run(
        {
          ...policy,
          confirmed: true,
          expectedRevision: 1,
          autoEnabled: true,
          applyDate: date,
          rules: [
            {
              id: 'pneumonia',
              kind: 'assign',
              cie10Code: 'J18.9',
              specialty: 'Med Interna',
              scope: 'all',
              revision: 1,
            },
          ],
        },
        context('admin')
      );
      expect((await stored()).beds[bed].specialty).toBe('Med Interna');
    }
    expect((await stored()).meta).toMatchObject({ fieldWrites: { revision: 4 } });
    await checkReplay(sent, expected);
  });
});
