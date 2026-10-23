import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DAY,
  POLICY_PATH,
  RUN_ID,
  SPLIT_ENV,
  batchApi,
  checkpoint,
  createFakeFirestore,
  currentVersion,
  dayPath,
  makeContext,
  makeDay,
  vitals,
} from './clinicalDerivedServer.test-support';

/*
 * D11 run copy of the clinical batch across the chunks of one run: the batch copy is the full day,
 * so an episode a later chunk splits must move out of the copy's beds, never be stored twice.
 */

type Holder = Record<string, unknown>;
type Copy = Record<string, unknown> & {
  beds: Record<string, Holder>;
  clinicalDerivedPrevious: Record<string, { embedded?: Holder; document?: Holder }>;
};

const bytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value), 'utf8');

const ENFORCED = { schemaVersion: 2, mode: 'preview', revision: 4, clinicalBatchMode: 'enforced' };

const setup = () => {
  const fake = createFakeFirestore();
  fake.seed(POLICY_PATH, ENFORCED);
  const day = makeDay({
    rayenSyncHistory: [
      {
        id: RUN_ID,
        status: 'applied',
        sourceDate: DAY,
        policy: { mode: 'preview', revision: 4, clinicalBatchMode: 'enforced' },
      },
    ],
  });
  return { fake, day, api: batchApi(fake) };
};

/** One chunk of RUN_ID writing `fields` on one target, based on the day as it is now. */
const chunk = (
  fake: ReturnType<typeof createFakeFirestore>,
  mutationId: string,
  target: { bedId: string; clinicalEpisodeId: string },
  fields: Holder
) => ({
  date: DAY,
  authorityDate: DAY,
  runId: RUN_ID,
  mutationId,
  expectedLastUpdated: currentVersion(fake),
  baseRevision: (fake.read(dayPath()) as { meta: { revision: number } }).meta.revision,
  fieldContractVersion: 2,
  mode: 'enforced',
  patches: [{ ...target, fields }],
  checkpoints: [],
  clientRuntimeContractVersion: 3,
});

const MOTHER = { bedId: 'R1', clinicalEpisodeId: 'ep_madre_1' };
const PASSPORT = { bedId: 'R2', clinicalEpisodeId: 'ep_pasaporte_2' };
const runCopy = (fake: ReturnType<typeof createFakeFirestore>) => {
  const [path, ...others] = fake.paths(`${dayPath()}/history/rayen-clinical-`);
  expect(others).toEqual([]);
  return fake.read(path) as Copy;
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'], now: new Date(`${DAY}T16:00:00.000Z`) });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe('clinical batch run copy across the chunks of one run (D11)', () => {
  it('moves a later chunk episode out of the copy beds, so a near-limit day still fits', async () => {
    // About 675 KB: the mother's history alone is about 350 KB; the 900 KB check still passes.
    const { fake, day, api } = setup();
    const beds = day.beds as Record<string, Holder>;
    beds.R1.vitalSignsHistory = [{ ...vitals('2026-11-01', 80), note: 'm'.repeat(350_000) }];
    beds.R2.pathology = 'p'.repeat(320_000);
    expect(bytes(day)).toBeGreaterThan(670_000);
    const motherHistory = structuredClone(beds.R1.vitalSignsHistory);

    for (const switchValue of [undefined, DAY]) {
      vi.stubEnv(SPLIT_ENV, switchValue);
      fake.docs.clear();
      fake.seed(POLICY_PATH, ENFORCED);
      fake.seed(dayPath(), day);

      const first = await api.applyRayenClinicalEnrichmentBatch.run(
        chunk(fake, 'mutation-chunk-1', PASSPORT, { vitalSignsHistory: [vitals(DAY, 72)] }),
        makeContext()
      );
      const firstCopyBytes = bytes(runCopy(fake));
      const second = await api.applyRayenClinicalEnrichmentBatch.run(
        chunk(fake, 'mutation-chunk-2', MOTHER, { vitalSignsHistory: [vitals(DAY, 88)] }),
        makeContext()
      );

      expect(first, String(switchValue)).toMatchObject({ authorityStatus: 'ok' });
      expect(second, String(switchValue)).toMatchObject({
        authorityStatus: 'ok',
        historySnapshots: 0,
      });
      if (switchValue === undefined) continue;
      const copy = runCopy(fake);
      expect(copy.beds.R1).not.toHaveProperty('vitalSignsHistory');
      expect(copy.beds.R1).not.toHaveProperty('clinicalSyncCheckpoint');
      expect(copy.clinicalDerivedPrevious.ep_madre_1).toEqual({
        embedded: { vitalSignsHistory: motherHistory, clinicalSyncCheckpoint: checkpoint('m-1') },
      });
      // Never heavier than the copy it extends, beyond the entry's own keys.
      expect(bytes(copy) - firstCopyBytes).toBeLessThan(200);
    }
  });

  it('keeps in the copy beds a value the run wrote before it split the episode', async () => {
    const { fake, day, api } = setup();
    fake.seed(dayPath(), day);
    // First chunk while the switch is still off for this date: the mother's value stays embedded.
    vi.stubEnv(SPLIT_ENV, '2026-11-03');
    await api.applyRayenClinicalEnrichmentBatch.run(
      chunk(fake, 'mutation-chunk-1', MOTHER, { vitalSignsHistory: [vitals(DAY, 85)] }),
      makeContext()
    );
    vi.stubEnv(SPLIT_ENV, DAY);

    await api.applyRayenClinicalEnrichmentBatch.run(
      chunk(fake, 'mutation-chunk-2', MOTHER, { vitalSignsHistory: [vitals(DAY, 88)] }),
      makeContext()
    );

    const copy = runCopy(fake);
    // The value before the run first wrote the episode stays in the beds; the one this write
    // deletes from the day goes to the entry. The unchanged checkpoint is stored only once.
    expect(copy.beds.R1.vitalSignsHistory).toEqual([vitals('2026-11-01', 80)]);
    expect(copy.beds.R1).not.toHaveProperty('clinicalSyncCheckpoint');
    expect(copy.clinicalDerivedPrevious.ep_madre_1).toEqual({
      embedded: { vitalSignsHistory: [vitals(DAY, 85)], clinicalSyncCheckpoint: checkpoint('m-1') },
    });
    expect(copy.beds.R1.clinicalCrib).toMatchObject({
      vitalSignsHistory: [vitals('2026-11-01', 140)],
    });
  });

  it('refuses an extension over the safe size and writes nothing', async () => {
    // The copy keeps the value the run found (350 KB) and gains the one it wrote unsplit (350 KB).
    const { fake, day, api } = setup();
    const beds = day.beds as Record<string, Holder>;
    beds.R1.vitalSignsHistory = [{ ...vitals('2026-11-01', 80), note: 'a'.repeat(350_000) }];
    beds.R2.pathology = 'p'.repeat(220_000);
    fake.seed(dayPath(), day);
    vi.stubEnv(SPLIT_ENV, '2026-11-03');
    await api.applyRayenClinicalEnrichmentBatch.run(
      chunk(fake, 'mutation-chunk-1', MOTHER, {
        vitalSignsHistory: [{ ...vitals(DAY, 85), note: 'b'.repeat(350_000) }],
      }),
      makeContext()
    );
    vi.stubEnv(SPLIT_ENV, DAY);
    const before = structuredClone([...fake.docs.entries()]);
    const logLength = fake.log.length;

    await expect(
      api.applyRayenClinicalEnrichmentBatch.run(
        chunk(fake, 'mutation-chunk-2', MOTHER, { vitalSignsHistory: [vitals(DAY, 88)] }),
        makeContext()
      )
    ).rejects.toMatchObject({ code: 'resource-exhausted' });

    expect(fake.log.slice(logLength).filter(entry => entry.op !== 'get')).toEqual([]);
    expect(
      [...fake.docs.entries()].filter(([path]) => !path.includes('/functionsTelemetry/'))
    ).toEqual(before.filter(([path]) => !path.includes('/functionsTelemetry/')));
  });
});
