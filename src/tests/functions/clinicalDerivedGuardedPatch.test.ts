import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DAY,
  POLICY_PATH,
  PRIOR_DAY,
  RUN_ID,
  SPLIT_ENV,
  checkpoint,
  createFakeFirestore,
  dayPath,
  episodeDoc,
  episodePath,
  guardedPatch,
  currentVersion,
  makeContext,
  makeDay,
  marker,
  shadowPolicy,
  vitals,
  writeApi,
} from './clinicalDerivedServer.test-support';

const RUN_COPY = `${dayPath()}/history/rayen-${RUN_ID}`;
const NEW_VITALS = [vitals('2026-11-02', 72), vitals('2026-11-01', 70)];

type Day = Record<string, unknown> & {
  beds: Record<string, Record<string, unknown> & { clinicalCrib?: Record<string, unknown> }>;
  meta: Record<string, unknown>;
  clinicalDerivedLayout?: { version: number; generation: string };
};

const setup = (day = makeDay()) => {
  const fake = createFakeFirestore();
  fake.seed(POLICY_PATH, shadowPolicy);
  fake.seed(dayPath(), day);
  return { fake, api: writeApi(fake) };
};

const patchR2Vitals = (overrides = {}) =>
  guardedPatch({ 'beds.R2.vitalSignsHistory': NEW_VITALS }, overrides);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'], now: new Date(`${DAY}T16:00:00.000Z`) });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe('guarded patch on a split day (phase 1a P5)', () => {
  it('marks the day on its first moved-field write and moves that episode out of the day', async () => {
    vi.stubEnv(SPLIT_ENV, PRIOR_DAY);
    const { fake, api } = setup();

    const response = await api.patchDailyRecordWithClinicalAuthority.run(
      patchR2Vitals(),
      makeContext()
    );

    const day = fake.read(dayPath()) as Day;
    const generation = day.clinicalDerivedLayout?.generation;
    expect(day.clinicalDerivedLayout).toEqual({ version: 1, generation: expect.any(String) });
    expect(day.meta).toMatchObject({
      revision: 8,
      lastMutationId: 'mutation-patch-1',
      lastChangedPaths: ['beds.R2.vitalSignsHistory'],
    });
    // Both embedded copies of the written episode leave the day (D6); the others stay.
    expect(day.beds.R2).not.toHaveProperty('vitalSignsHistory');
    expect(day.beds.R2).not.toHaveProperty('clinicalSyncCheckpoint');
    expect(day.beds.R2).toMatchObject({ rut: 'AB123456', documentType: 'Pasaporte' });
    expect(day.beds.R1.vitalSignsHistory).toEqual([vitals('2026-11-01', 80)]);
    expect(day.beds.R1.clinicalCrib?.vitalSignsHistory).toEqual([vitals('2026-11-01', 140)]);

    expect(fake.read(episodePath('ep_pasaporte_2'))).toEqual({
      schemaVersion: 1,
      date: DAY,
      clinicalEpisodeId: 'ep_pasaporte_2',
      layoutGeneration: generation,
      target: 'bed',
      bedId: 'R2',
      dayRevision: 8,
      updatedAt: day.lastUpdated,
      lastMutationId: 'mutation-patch-1',
      vitalSignsHistory: NEW_VITALS,
      clinicalSyncCheckpoint: checkpoint('p-1'),
    });

    // D8: the response carries the day exactly as persisted, never an overlaid record.
    expect(response.revision).toBe(8);
    const state = response.recordState;
    expect(state.record.clinicalDerivedLayout).toEqual(day.clinicalDerivedLayout);
    expect(state.record.beds.R2).not.toHaveProperty('vitalSignsHistory');
    expect(state.record.beds.R2).not.toHaveProperty('clinicalSyncCheckpoint');
    expect(state.record.beds.R1.vitalSignsHistory).toEqual(day.beds.R1.vitalSignsHistory);
    expect(state.record.meta.revision).toBe(8);
    expect(state.lastUpdated).toBe(currentVersion(fake));

    const [telemetry] = fake.telemetry();
    expect(telemetry.context).toMatchObject({
      clinicalDerivedLayout: 'marking',
      clinicalDerivedSplitEpisodes: 1,
      clinicalDerivedEmbeddedEpisodes: 0,
      clinicalDerivedOverlaidEpisodes: 0,
    });
    expect(JSON.stringify(telemetry.context)).not.toMatch(/ep_|AB123456|heartRate/);
  });

  it('follows the marker with the switch off and keeps the moved field it did not write from the document', async () => {
    const day = makeDay({ clinicalDerivedLayout: marker() });
    const r2 = (day.beds as Day['beds']).R2;
    delete r2.vitalSignsHistory;
    delete r2.clinicalSyncCheckpoint;
    const { fake, api } = setup(day);
    fake.seed(
      episodePath('ep_pasaporte_2'),
      episodeDoc('ep_pasaporte_2', {
        vitalSignsHistory: [vitals('2026-11-01', 66)],
        clinicalSyncCheckpoint: checkpoint('p-doc'),
      })
    );

    await api.patchDailyRecordWithClinicalAuthority.run(
      guardedPatch({ 'beds.R2.clinicalSyncCheckpoint': checkpoint('p-2') }),
      makeContext()
    );

    const stored = fake.read(dayPath()) as Day;
    expect(stored.clinicalDerivedLayout).toEqual(marker());
    expect(stored.beds.R2).not.toHaveProperty('clinicalSyncCheckpoint');
    expect(fake.read(episodePath('ep_pasaporte_2'))).toMatchObject({
      layoutGeneration: 'gen-current',
      dayRevision: 8,
      clinicalSyncCheckpoint: checkpoint('p-2'),
      vitalSignsHistory: [vitals('2026-11-01', 66)],
    });
  });

  it.each([
    ['missing', undefined],
    ['older', 2],
    ['not an integer', '3'],
  ])(
    'rejects a %s client version before any write and without touching the documents',
    async (_label, version) => {
      vi.stubEnv(SPLIT_ENV, PRIOR_DAY);
      const { fake, api } = setup();
      const before = structuredClone(fake.read(dayPath()));

      await expect(
        api.patchDailyRecordWithClinicalAuthority.run(
          patchR2Vitals({ clientRuntimeContractVersion: version }),
          makeContext()
        )
      ).rejects.toMatchObject({
        code: 'failed-precondition',
        message: expect.stringMatching(/^clinical_derived_client_outdated:/),
      });
      expect(fake.read(dayPath())).toEqual(before);
      expect(fake.touched('/clinicalDerived/')).toEqual([]);
      expect(fake.log.filter(entry => entry.op !== 'get')).toEqual([]);
    }
  );

  it('answers a retry of a committed mutation idempotently, even from an older client', async () => {
    vi.stubEnv(SPLIT_ENV, PRIOR_DAY);
    const { fake, api } = setup();
    await api.patchDailyRecordWithClinicalAuthority.run(patchR2Vitals(), makeContext());
    const committed = structuredClone(fake.read(dayPath())) as Day;
    const writesBefore = fake.log.filter(entry => entry.op !== 'get').length;

    const retry = await api.patchDailyRecordWithClinicalAuthority.run(
      patchR2Vitals({ clientRuntimeContractVersion: undefined }),
      makeContext()
    );

    expect(retry.authorityStatus).toBe('idempotent');
    expect(retry.revision).toBe(8);
    expect(retry.recordState.record.clinicalDerivedLayout).toEqual(committed.clinicalDerivedLayout);
    expect(retry.recordState.record.beds.R2).not.toHaveProperty('vitalSignsHistory');
    expect(fake.log.filter(entry => entry.op !== 'get')).toHaveLength(writesBefore);
    expect(fake.read(dayPath())).toEqual(committed);
  });

  it('keeps in the run copy what each episode had before the run first wrote it (D11)', async () => {
    vi.stubEnv(SPLIT_ENV, PRIOR_DAY);
    const runEvents = (makeDay().rayenSyncHistory as Array<Record<string, unknown>>).flatMap(
      event => [event, { ...event, id: 'run-synthetic-2' }]
    );
    const { fake, api } = setup(makeDay({ rayenSyncHistory: runEvents }));
    const run = async (patch: Record<string, unknown>, mutationId: string, runId = RUN_ID) =>
      api.patchDailyRecordWithClinicalAuthority.run(
        guardedPatch(patch, {
          expectedLastUpdated: currentVersion(fake),
          syncContract: { mutationId, changedPaths: Object.keys(patch) },
          rayenClinicalWriteGuard: {
            ...(guardedPatch({}).rayenClinicalWriteGuard as object),
            runId,
          },
        }),
        makeContext()
      );

    await run({ 'beds.R2.vitalSignsHistory': NEW_VITALS }, 'm-1');
    const firstCopy = fake.read(RUN_COPY) as Record<string, Record<string, unknown>>;
    expect(firstCopy.historyCompression).toBe('slim-v1');
    expect(firstCopy.clinicalDerivedPrevious).toEqual({
      ep_pasaporte_2: {
        embedded: {
          clinicalSyncCheckpoint: checkpoint('p-1'),
          vitalSignsHistory: [vitals('2026-11-01', 70)],
        },
      },
    });

    // A later patch of the same run adds its episode; a repeated episode keeps its first value.
    await run({ 'beds.R1.vitalSignsHistory': [vitals('2026-11-02', 90)] }, 'm-2');
    await run({ 'beds.R2.clinicalSyncCheckpoint': checkpoint('p-3') }, 'm-3');
    const extended = fake.read(RUN_COPY) as Record<string, Record<string, unknown>>;
    expect(Object.keys(extended.clinicalDerivedPrevious).sort()).toEqual([
      'ep_madre_1',
      'ep_pasaporte_2',
    ]);
    expect(extended.clinicalDerivedPrevious.ep_pasaporte_2).toEqual(
      firstCopy.clinicalDerivedPrevious.ep_pasaporte_2
    );
    expect(extended.clinicalDerivedPrevious.ep_madre_1).toEqual({
      embedded: {
        clinicalSyncCheckpoint: checkpoint('m-1'),
        vitalSignsHistory: [vitals('2026-11-01', 80)],
      },
    });

    // The next run starts from the episode document.
    await run({ 'beds.R2.vitalSignsHistory': [] }, 'm-4', 'run-synthetic-2');
    const generation = (fake.read(dayPath()) as Day).clinicalDerivedLayout?.generation;
    expect(fake.read(`${dayPath()}/history/rayen-run-synthetic-2`)).toMatchObject({
      clinicalDerivedPrevious: {
        ep_pasaporte_2: {
          document: {
            layoutGeneration: generation,
            date: DAY,
            clinicalSyncCheckpoint: checkpoint('p-3'),
            vitalSignsHistory: NEW_VITALS,
          },
        },
      },
    });
  });

  it.each([
    ['a day this write marks', {}],
    ['a marked day', { clinicalDerivedLayout: marker() }],
  ])(
    'ignores a leftover of another generation on %s but saves it in the run copy',
    async (_l, extra) => {
      vi.stubEnv(SPLIT_ENV, PRIOR_DAY);
      const { fake, api } = setup(makeDay(extra));
      const leftover = episodeDoc('ep_pasaporte_2', {
        layoutGeneration: 'gen-deleted-day',
        vitalSignsHistory: [vitals('2026-10-20', 99)],
        clinicalSyncCheckpoint: checkpoint('old'),
      });
      fake.seed(episodePath('ep_pasaporte_2'), leftover);

      await api.patchDailyRecordWithClinicalAuthority.run(
        guardedPatch({ 'beds.R2.clinicalSyncCheckpoint': checkpoint('p-2') }),
        makeContext()
      );

      const generation = (fake.read(dayPath()) as Day).clinicalDerivedLayout?.generation;
      expect(generation).not.toBe('gen-deleted-day');
      if ('clinicalDerivedLayout' in extra) expect(generation).toBe('gen-current');
      expect(fake.read(episodePath('ep_pasaporte_2'))).toMatchObject({
        layoutGeneration: generation,
        vitalSignsHistory: [vitals('2026-11-01', 70)],
        clinicalSyncCheckpoint: checkpoint('p-2'),
      });
      expect(
        (fake.read(RUN_COPY) as Record<string, Record<string, unknown>>).clinicalDerivedPrevious
      ).toEqual({
        ep_pasaporte_2: {
          document: {
            layoutGeneration: 'gen-deleted-day',
            date: DAY,
            vitalSignsHistory: [vitals('2026-10-20', 99)],
            clinicalSyncCheckpoint: checkpoint('old'),
          },
          embedded: {
            vitalSignsHistory: [vitals('2026-11-01', 70)],
            clinicalSyncCheckpoint: checkpoint('p-1'),
          },
        },
      });
    }
  );

  it('splits the newborn crib apart from the mother: distinct episodes, distinct documents', async () => {
    vi.stubEnv(SPLIT_ENV, PRIOR_DAY);
    const { fake, api } = setup();

    await api.patchDailyRecordWithClinicalAuthority.run(
      guardedPatch({ 'beds.R1.clinicalCrib.vitalSignsHistory': [vitals('2026-11-02', 150)] }),
      makeContext()
    );

    const day = fake.read(dayPath()) as Day;
    expect(day.beds.R1.clinicalCrib).not.toHaveProperty('vitalSignsHistory');
    expect(day.beds.R1.clinicalCrib).toMatchObject({ rut: 'XK1234567', documentType: 'Pasaporte' });
    expect(day.beds.R1.vitalSignsHistory).toEqual([vitals('2026-11-01', 80)]);
    expect(fake.paths(`${dayPath()}/clinicalDerived/`)).toEqual([episodePath('ep_rn_1')]);
    expect(fake.read(episodePath('ep_rn_1'))).toMatchObject({
      target: 'clinicalCrib',
      bedId: 'R1',
      vitalSignsHistory: [vitals('2026-11-02', 150)],
      clinicalSyncCheckpoint: null,
    });
  });

  it('keeps an episode without a valid document id embedded, as before', async () => {
    vi.stubEnv(SPLIT_ENV, PRIOR_DAY);
    const day = makeDay();
    (day.beds as Day['beds']).R2.clinicalEpisodeId = 'ep.not.a.doc.id';
    const { fake, api } = setup(day);

    await api.patchDailyRecordWithClinicalAuthority.run(patchR2Vitals(), makeContext());

    const stored = fake.read(dayPath()) as Day;
    expect(stored.clinicalDerivedLayout).toEqual({ version: 1, generation: expect.any(String) });
    expect(stored.beds.R2.vitalSignsHistory).toEqual(NEW_VITALS);
    expect(stored.beds.R2.clinicalSyncCheckpoint).toEqual(checkpoint('p-1'));
    expect(fake.paths(`${dayPath()}/clinicalDerived/`)).toEqual([]);
    expect(fake.telemetry()[0].context).toMatchObject({
      clinicalDerivedSplitEpisodes: 0,
      clinicalDerivedEmbeddedEpisodes: 1,
    });
  });

  it('fails closed on a marker this server does not understand', async () => {
    const { fake, api } = setup(
      makeDay({ clinicalDerivedLayout: { version: 2, generation: 'g' } })
    );

    await expect(
      api.patchDailyRecordWithClinicalAuthority.run(patchR2Vitals(), makeContext())
    ).rejects.toMatchObject({
      code: 'failed-precondition',
      message: expect.stringMatching(/^clinical_derived_layout_unsupported:/),
    });
    expect(fake.log.filter(entry => entry.op !== 'get')).toEqual([]);
  });

  it('never marks a historical CUDYR target, and keeps the marker of a marked one', async () => {
    vi.stubEnv(SPLIT_ENV, PRIOR_DAY);
    for (const priorMarker of [undefined, marker('gen-prior')]) {
      const { fake } = setup();
      const prior = makeDay({
        date: PRIOR_DAY,
        lastUpdated: `${PRIOR_DAY}T10:00:00.000Z`,
        rayenSyncHistory: [],
        ...(priorMarker ? { clinicalDerivedLayout: priorMarker } : {}),
      });
      fake.seed(dayPath(PRIOR_DAY), prior);
      const cudyr = { category: 'C2', recordedDate: PRIOR_DAY, source: 'Rayen sintético' };

      await writeApi(fake, 'admin').patchDailyRecordWithClinicalAuthority.run(
        guardedPatch(
          { 'beds.R2.evaluationScores.cudyr': cudyr },
          {
            date: PRIOR_DAY,
            expectedLastUpdated: `${PRIOR_DAY}T10:00:00.000Z`,
            clientRuntimeContractVersion: undefined,
            rayenClinicalWriteGuard: {
              ...(guardedPatch({}).rayenClinicalWriteGuard as object),
              recordScope: 'historical',
            },
          }
        ),
        makeContext()
      );

      const stored = fake.read(dayPath(PRIOR_DAY)) as Day;
      expect(stored.clinicalDerivedLayout).toEqual(priorMarker);
      expect(stored.beds.R2.vitalSignsHistory).toEqual([vitals('2026-11-01', 70)]);
      expect((stored.beds.R2.evaluationScores as Record<string, unknown>).cudyr).toEqual(cudyr);
      expect(fake.touched('/clinicalDerived/')).toEqual([]);
    }
  });
});
