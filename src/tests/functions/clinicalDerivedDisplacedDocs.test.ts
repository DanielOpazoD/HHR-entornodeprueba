import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DAY,
  POLICY_PATH,
  RUN_ID,
  SPLIT_ENV,
  batchApi,
  checkpoint,
  createFakeFirestore,
  dayPath,
  episodeDoc,
  episodePath,
  guardedPatch,
  makeContext,
  makeDay,
  marker,
  vitals,
  writeApi,
  type FakeFirestore,
} from './clinicalDerivedServer.test-support';

/*
 * D14: an episode document's id is the episode, not the generation. A day deleted and recreated
 * (an administrator's backup restore) gets a new generation, so its first split write `set`s over
 * the previous life's document. That document must survive in the day's history whatever the
 * writer: the guarded patch, the batch (also checkpoint-only, which keeps no run copy) and the full
 * save (which writes no episode document). Synthetic data only.
 */

type Data = Record<string, unknown>;
type Day = Data & { beds: Record<string, Data & { clinicalCrib?: Data }> };

const ENFORCED = { schemaVersion: 2, mode: 'preview', revision: 4, clinicalBatchMode: 'enforced' };
const enforcedRun = {
  id: RUN_ID,
  status: 'applied',
  sourceDate: DAY,
  policy: { mode: 'preview', revision: 4, clinicalBatchMode: 'enforced' },
};

/** The recreated day: no embedded copy for the passport patient, whose history lived in a document. */
const recreatedDay = (extra: Data = {}) => {
  const day = makeDay({ rayenSyncHistory: [enforcedRun], ...extra }) as Day;
  delete day.beds.R2.vitalSignsHistory;
  delete day.beds.R2.clinicalSyncCheckpoint;
  return day;
};

const leftoverOf = (episodeId: string, bedId: string, heartRate: number) =>
  episodeDoc(
    episodeId,
    {
      vitalSignsHistory: [vitals('2026-11-01', heartRate), vitals('2026-10-31', heartRate - 1)],
      clinicalSyncCheckpoint: checkpoint(`old-${episodeId}`),
    },
    { layoutGeneration: 'gen-deleted-day', bedId, lastMutationId: 'deleted-day-write' }
  );

const setup = (day: Data) => {
  const fake = createFakeFirestore();
  fake.seed(POLICY_PATH, ENFORCED);
  fake.seed(dayPath(), day);
  return fake;
};

/** Every copy of `episodeId`'s document that the day's history keeps. */
const keptDocuments = (fake: FakeFirestore, episodeId: string) =>
  fake
    .paths(`${dayPath()}/history/`)
    .map(path => (fake.read(path)?.clinicalDerivedPrevious as Data | undefined)?.[episodeId])
    .map(entry => (entry as Data | undefined)?.document)
    .filter(Boolean);

const checkpointOnlyBatch = (overrides: Data = {}) => ({
  date: DAY,
  authorityDate: DAY,
  runId: RUN_ID,
  mutationId: 'mutation-batch-cp',
  expectedLastUpdated: `${DAY}T10:00:00.000Z`,
  baseRevision: 7,
  fieldContractVersion: 2,
  mode: 'enforced',
  patches: [],
  checkpoints: [
    { bedId: 'R2', clinicalEpisodeId: 'ep_pasaporte_2', checkpoint: checkpoint('p-9') },
  ],
  clientRuntimeContractVersion: 3,
  ...overrides,
});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'], now: new Date(`${DAY}T16:00:00.000Z`) });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe('displaced episode documents (D14)', () => {
  it.each([
    ['a day this batch marks', {}],
    ['a day restored with a new generation', { clinicalDerivedLayout: marker('gen-restored') }],
  ])('a checkpoint-only batch keeps the leftover it replaces on %s', async (_label, extra) => {
    vi.stubEnv(SPLIT_ENV, DAY);
    const fake = setup(recreatedDay(extra));
    const leftover = leftoverOf('ep_pasaporte_2', 'R2', 66);
    fake.seed(episodePath('ep_pasaporte_2'), leftover);

    await batchApi(fake).applyRayenClinicalEnrichmentBatch.run(
      checkpointOnlyBatch(),
      makeContext()
    );

    const generation = (fake.read(dayPath()) as Day & { clinicalDerivedLayout: Data })
      .clinicalDerivedLayout.generation;
    expect(fake.read(episodePath('ep_pasaporte_2'))).toMatchObject({
      layoutGeneration: generation,
      clinicalSyncCheckpoint: checkpoint('p-9'),
    });
    expect(keptDocuments(fake, 'ep_pasaporte_2')).toEqual([leftover]);
    const [telemetry] = fake.telemetry();
    expect(telemetry.context).toMatchObject({ clinicalDerivedDisplacedDocs: 1 });
    expect(JSON.stringify(telemetry.context)).not.toMatch(/ep_|gen-deleted-day|heartRate/);
  });

  it('keeps the mother and newborn leftovers apart when one batch replaces both', async () => {
    vi.stubEnv(SPLIT_ENV, DAY);
    const fake = setup(recreatedDay());
    const mother = leftoverOf('ep_madre_1', 'R1', 81);
    const newborn = { ...leftoverOf('ep_rn_1', 'R1', 141), target: 'clinicalCrib' };
    fake.seed(episodePath('ep_madre_1'), mother);
    fake.seed(episodePath('ep_rn_1'), newborn);

    await batchApi(fake).applyRayenClinicalEnrichmentBatch.run(
      checkpointOnlyBatch({
        patches: [
          {
            bedId: 'R1',
            clinicalEpisodeId: 'ep_madre_1',
            fields: { vitalSignsHistory: [vitals(DAY, 90)] },
          },
          {
            bedId: 'R1',
            clinicalCrib: true,
            clinicalEpisodeId: 'ep_rn_1',
            fields: { vitalSignsHistory: [vitals(DAY, 150)] },
          },
        ],
        checkpoints: [],
      }),
      makeContext()
    );

    expect(keptDocuments(fake, 'ep_madre_1')).toContainEqual(mother);
    expect(keptDocuments(fake, 'ep_rn_1')).toContainEqual(newborn);
    expect(keptDocuments(fake, 'ep_madre_1')).not.toContainEqual(newborn);
    expect(fake.read(episodePath('ep_rn_1'))).toMatchObject({
      vitalSignsHistory: [vitals(DAY, 150)],
    });
  });

  it('a guarded patch keeps the whole leftover, not only the moved values of its run copy', async () => {
    vi.stubEnv(SPLIT_ENV, DAY);
    const fake = setup(recreatedDay({ rayenSyncHistory: makeDay().rayenSyncHistory }));
    fake.seed(POLICY_PATH, { ...ENFORCED, clinicalBatchMode: 'shadow' });
    const leftover = leftoverOf('ep_pasaporte_2', 'R2', 66);
    fake.seed(episodePath('ep_pasaporte_2'), leftover);

    await writeApi(fake).patchDailyRecordWithClinicalAuthority.run(
      guardedPatch({ 'beds.R2.clinicalSyncCheckpoint': checkpoint('p-2') }),
      makeContext()
    );

    expect(fake.read(episodePath('ep_pasaporte_2'))).toMatchObject({
      clinicalSyncCheckpoint: checkpoint('p-2'),
    });
    expect(keptDocuments(fake, 'ep_pasaporte_2')).toContainEqual(leftover);
  });

  it('keeps no copy when the replaced document is the current one', async () => {
    vi.stubEnv(SPLIT_ENV, DAY);
    const fake = setup(recreatedDay({ clinicalDerivedLayout: marker() }));
    fake.seed(
      episodePath('ep_pasaporte_2'),
      episodeDoc('ep_pasaporte_2', { vitalSignsHistory: [vitals('2026-11-01', 70)] })
    );

    await batchApi(fake).applyRayenClinicalEnrichmentBatch.run(
      checkpointOnlyBatch(),
      makeContext()
    );

    expect(fake.paths(`${dayPath()}/history/`)).toEqual([]);
    expect(fake.read(episodePath('ep_pasaporte_2'))).toMatchObject({
      layoutGeneration: 'gen-current',
      vitalSignsHistory: [vitals('2026-11-01', 70)],
      clinicalSyncCheckpoint: checkpoint('p-9'),
    });
  });

  it('a full save of the restored day leaves the leftover untouched', async () => {
    vi.stubEnv(SPLIT_ENV, DAY);
    const fake = createFakeFirestore();
    fake.seed(POLICY_PATH, ENFORCED);
    const leftover = leftoverOf('ep_pasaporte_2', 'R2', 66);
    fake.seed(episodePath('ep_pasaporte_2'), leftover);

    await writeApi(fake, 'admin').saveDailyRecordWithClinicalAuthority.run(
      {
        date: DAY,
        mode: 'shadow',
        origin: 'backup_restore',
        record: recreatedDay({ clinicalDerivedLayout: marker('gen-deleted-day') }),
        clientRuntimeContractVersion: 3,
      },
      makeContext()
    );

    expect(fake.read(dayPath())?.clinicalDerivedLayout).not.toEqual(marker('gen-deleted-day'));
    expect(fake.read(episodePath('ep_pasaporte_2'))).toEqual(leftover);
  });
});
